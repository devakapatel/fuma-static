import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  claimIntentPaid,
  findIntentById,
  findIntentByLinkId,
  findIntentByQrId,
  fulfilIntent,
  recordWebhookEvent,
  type PaymentIntentRow,
} from '../../_lib/payments';
import { verifyWebhookSignature } from '../../_lib/razorpay';
import type { Env, PagesFunction } from '../../_lib/types';

interface WebhookPayment {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    qr_code?: { entity?: { id?: string } };
    payment_link?: {
      entity?: {
        id?: string;
        status?: string;
        amount?: number;
        amount_paid?: number;
        currency?: string;
      };
    };
    payment?: { entity?: WebhookPayment };
  };
}

interface SettleInput {
  intent: PaymentIntentRow | null;
  paymentId: string | undefined;
  amount: number | undefined;
  currency: string | undefined;
  status: string | undefined;
  eventId: string;
  eventType: string;
  unknown: string;
}

/**
 * Common fulfilment path for every payment-producing webhook. It is safe to
 * call more than once: `claimIntentPaid` and `fulfilIntent` are guarded, so a
 * retried delivery cannot credit an account twice.
 */
async function settleIntent(
  request: Request,
  env: Env,
  input: SettleInput,
): Promise<Response> {
  const found = input.intent;

  if (!found) {
    console.warn(`Razorpay webhook ${input.eventType}: ${input.unknown}`);
    return jsonResponse(request, env, { ok: true, ignored: input.unknown });
  }

  if (!input.paymentId) {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  if (input.currency && input.currency !== found.currency) {
    console.error(
      `Razorpay webhook ${input.eventType}: currency mismatch for ${found.id} (${input.currency} != ${found.currency})`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'currency_mismatch' });
  }

  if (Number(input.amount) !== found.amount) {
    console.error(
      `Razorpay webhook ${input.eventType}: amount mismatch for ${found.id} (${input.amount} != ${found.amount})`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'amount_mismatch' });
  }

  if (input.status && input.status !== 'captured' && input.status !== 'authorized') {
    return jsonResponse(request, env, { ok: true, ignored: `payment_${input.status}` });
  }

  let intent = found;

  if (intent.status !== 'paid') {
    await claimIntentPaid(env.DB, intent.id, input.paymentId);
    // Re-read either way: another delivery may have won the race.
    intent = (await findIntentById(env.DB, intent.id)) ?? intent;
  }

  if (intent.status !== 'paid') {
    return jsonResponse(request, env, { ok: true, ignored: `intent_${intent.status}` });
  }

  if (intent.razorpay_payment_id && intent.razorpay_payment_id !== input.paymentId) {
    console.error(
      `Razorpay webhook ${input.eventType}: intent ${intent.id} already paid by ${intent.razorpay_payment_id}, got ${input.paymentId}`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'already_paid' });
  }

  if (intent.fulfilled_at) {
    await recordWebhookEvent(env.DB, { id: input.eventId, type: input.eventType });
    return jsonResponse(request, env, { ok: true, duplicate: true });
  }

  await fulfilIntent(env.DB, intent, { id: input.eventId, type: input.eventType });
  return jsonResponse(request, env, { ok: true });
}

/**
 * Razorpay calls this endpoint after a Payment Link is paid. The browser only
 * polls the intent; this webhook (and the reconciliation fallback in
 * `/api/payments/intent`) is what actually grants access.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.RAZORPAY_WEBHOOK_SECRET) {
    console.error('Razorpay webhook: missing DB or RAZORPAY_WEBHOOK_SECRET');
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  // Read the raw body once. Re-serialising parsed JSON changes the bytes and
  // breaks signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';

  if (!(await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET))) {
    return jsonResponse(request, env, { error: 'invalid_signature' }, 400);
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const eventType = body.event ?? 'unknown';
  const eventHeader = request.headers.get('x-razorpay-event-id');

  if (eventType === 'payment_link.paid') {
    const link = body.payload?.payment_link?.entity;
    const payment = body.payload?.payment?.entity;
    const paymentId = payment?.id;

    if (link?.status && link.status !== 'paid') {
      return jsonResponse(request, env, { ok: true, ignored: `link_${link.status}` });
    }

    return settleIntent(request, env, {
      intent: link?.id ? await findIntentByLinkId(env.DB, link.id) : null,
      paymentId,
      amount: payment?.amount,
      currency: payment?.currency,
      status: payment?.status,
      eventId: eventHeader ?? `link:${paymentId ?? 'unknown'}`,
      eventType,
      unknown: link?.id ? `unknown_link:${link.id}` : 'missing_link',
    });
  }

  // Legacy path for intents created while the site used the QR Codes API.
  if (eventType === 'qr_code.credited') {
    const qrId = body.payload?.qr_code?.entity?.id;
    const payment = body.payload?.payment?.entity;
    const paymentId = payment?.id;

    return settleIntent(request, env, {
      intent: qrId ? await findIntentByQrId(env.DB, qrId) : null,
      paymentId,
      amount: payment?.amount,
      currency: payment?.currency,
      status: payment?.status,
      eventId: eventHeader ?? `qr:${paymentId ?? 'unknown'}`,
      eventType,
      unknown: qrId ? `unknown_qr:${qrId}` : 'missing_qr',
    });
  }

  return jsonResponse(request, env, { ok: true, ignored: eventType });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
