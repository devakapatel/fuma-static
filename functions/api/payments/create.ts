import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  deletePaymentIntent,
  findIntentForUser,
  insertPaymentIntent,
  markIntentLinkCreated,
  PAYMENT_TTL_SECONDS,
  resolvePurchase,
  toPublicIntent,
} from '../../_lib/payments';
import {
  cancelPaymentLink,
  createPaymentLink,
  razorpayConfigured,
} from '../../_lib/razorpay';
import {
  isLoginRateLimited,
  recordFailedLogin,
} from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

function siteOrigin(request: Request, env: Env): string {
  if (env.SITE_URL) {
    try {
      return new URL(env.SITE_URL).origin;
    } catch {
      // Fall back to the request origin if SITE_URL is malformed.
    }
  }
  return new URL(request.url).origin;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }
  if (!razorpayConfigured(env)) {
    return jsonResponse(request, env, { error: 'payments_not_configured' }, 503);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const resolved = resolvePurchase(
    (body ?? {}) as {
      purpose?: unknown;
      planId?: unknown;
      amount?: unknown;
      details?: unknown;
    },
  );
  if (!resolved.purchase) {
    return jsonResponse(request, env, { error: resolved.error }, 400);
  }
  const purchase = resolved.purchase;

  // Reuse the generic attempts table to stop link spam.
  const rateKey = `payment:${auth.user.id}`;
  if (await isLoginRateLimited(env.DB, rateKey)) {
    return jsonResponse(request, env, { error: 'too_many_attempts' }, 429);
  }
  await recordFailedLogin(env.DB, rateKey);

  const intentId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + PAYMENT_TTL_SECONDS * 1000);

  try {
    await insertPaymentIntent(env.DB, {
      id: intentId,
      userId: auth.user.id,
      purpose: purchase.purpose,
      planId: purchase.planId,
      label: purchase.label,
      amount: purchase.amount,
      durationDays: purchase.durationDays,
      metadata: purchase.metadata,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Could not insert payment intent:', error);
    return jsonResponse(request, env, { error: 'server_error' }, 500);
  }

  let linkId: string | null = null;
  try {
    const link = await createPaymentLink(env, {
      amount: purchase.amount,
      description: purchase.label,
      referenceId: intentId,
      expireBy: Math.floor(expiresAt.getTime() / 1000),
      // The session email is the one shown on /account, so the payment record
      // matches the account that will be credited.
      customer: { email: auth.user.email },
      notes: {
        intent_id: intentId,
        user_id: auth.user.id,
        purpose: purchase.purpose,
      },
      callbackUrl: `${siteOrigin(request, env)}/account?paid=${encodeURIComponent(intentId)}`,
    });
    linkId = link.id;

    const linkExpiresAt = link.expire_by
      ? new Date(link.expire_by * 1000).toISOString()
      : expiresAt.toISOString();

    await markIntentLinkCreated(env.DB, intentId, {
      id: link.id,
      shortUrl: link.short_url,
      expiresAt: linkExpiresAt,
    });

    const row = await findIntentForUser(env.DB, intentId, auth.user.id);
    if (!row) throw new Error('Payment intent disappeared after link creation');

    return jsonResponse(request, env, { intent: toPublicIntent(row) }, 201);
  } catch (error) {
    console.error('Could not create Razorpay Payment Link:', error);

    if (linkId) {
      try {
        await cancelPaymentLink(env, linkId);
      } catch (cancelError) {
        console.error('Could not cancel orphaned Razorpay Payment Link:', cancelError);
      }
    }
    await deletePaymentIntent(env.DB, intentId).catch(() => undefined);

    return jsonResponse(request, env, { error: 'payment_provider_error' }, 502);
  }
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
