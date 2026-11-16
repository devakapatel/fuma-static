import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  deletePaymentIntent,
  findIntentForUser,
  insertPaymentIntent,
  markIntentQrCreated,
  QR_TTL_SECONDS,
  resolvePurchase,
  toPublicIntent,
} from '../../_lib/payments';
import {
  closeUpiQr,
  createUpiQr,
  razorpayConfigured,
} from '../../_lib/razorpay';
import {
  isLoginRateLimited,
  recordFailedLogin,
} from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

function qrName(purpose: 'ai' | 'donation' | 'ad'): string {
  if (purpose === 'ai') return 'T9 AI access';
  if (purpose === 'donation') return 'T9 donation';
  return 'T9 advertisement';
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

  // Reuse the generic attempts table to stop QR spam.
  const rateKey = `payment:${auth.user.id}`;
  if (await isLoginRateLimited(env.DB, rateKey)) {
    return jsonResponse(request, env, { error: 'too_many_attempts' }, 429);
  }
  await recordFailedLogin(env.DB, rateKey);

  const intentId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + QR_TTL_SECONDS * 1000);

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

  let qrId: string | null = null;
  try {
    const qr = await createUpiQr(env, {
      amount: purchase.amount,
      name: qrName(purchase.purpose),
      description: purchase.label,
      closeBy: Math.floor(expiresAt.getTime() / 1000),
      notes: {
        intent_id: intentId,
        user_id: auth.user.id,
        purpose: purchase.purpose,
      },
    });
    qrId = qr.id;

    if (!qr.image_url) {
      throw new Error('Razorpay returned no QR image URL');
    }

    const qrExpiresAt = qr.close_by
      ? new Date(qr.close_by * 1000).toISOString()
      : expiresAt.toISOString();

    await markIntentQrCreated(env.DB, intentId, {
      id: qr.id,
      imageUrl: qr.image_url,
      expiresAt: qrExpiresAt,
    });

    const row = await findIntentForUser(env.DB, intentId, auth.user.id);
    if (!row) throw new Error('Payment intent disappeared after QR creation');

    return jsonResponse(request, env, { intent: toPublicIntent(row) }, 201);
  } catch (error) {
    console.error('Could not create Razorpay QR:', error);

    if (qrId) {
      try {
        await closeUpiQr(env, qrId);
      } catch (closeError) {
        console.error('Could not close orphaned Razorpay QR:', closeError);
      }
    }
    await deletePaymentIntent(env.DB, intentId).catch(() => undefined);

    return jsonResponse(request, env, { error: 'payment_provider_error' }, 502);
  }
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
