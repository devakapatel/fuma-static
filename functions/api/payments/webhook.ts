import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  claimIntentPaid,
  findIntentByQrId,
  fulfilIntent,
  recordWebhookEvent,
} from '../../_lib/payments';
import { verifyWebhookSignature } from '../../_lib/razorpay';
import type { Env, PagesFunction } from '../../_lib/types';

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    qr_code?: { entity?: { id?: string } };
    payment?: {
      entity?: {
        id?: string;
        amount?: number;
        currency?: string;
        status?: string;
      };
    };
  };
}

/**
 * Razorpay calls this endpoint after a UPI payment is made against one of our
 * QR codes. It is the authoritative fulfilment path; the browser only polls
 * the intent status.
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

  if (body.event !== 'qr_code.credited') {
    return jsonResponse(request, env, { ok: true, ignored: body.event ?? 'unknown' });
  }

  const qrId = body.payload?.qr_code?.entity?.id;
  const payment = body.payload?.payment?.entity;
  const paymentId = payment?.id;

  if (!qrId || !paymentId) {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const found = await findIntentByQrId(env.DB, qrId);
  if (!found) {
    // The QR may belong to another Razorpay product on the same account.
    console.warn(`Razorpay webhook: no intent for QR ${qrId}`);
    return jsonResponse(request, env, { ok: true, ignored: 'unknown_qr' });
  }

  if (payment.currency && payment.currency !== found.currency) {
    console.error(
      `Razorpay webhook: currency mismatch for ${found.id} (${payment.currency} != ${found.currency})`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'currency_mismatch' });
  }

  if (Number(payment.amount) !== found.amount) {
    console.error(
      `Razorpay webhook: amount mismatch for ${found.id} (${payment.amount} != ${found.amount})`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'amount_mismatch' });
  }

  if (payment.status && payment.status !== 'captured' && payment.status !== 'authorized') {
    return jsonResponse(request, env, { ok: true, ignored: `payment_${payment.status}` });
  }

  const eventId = request.headers.get('x-razorpay-event-id') ?? `qr:${paymentId}`;
  let intent = found;

  if (intent.status !== 'paid') {
    const claimed = await claimIntentPaid(env.DB, intent.id, paymentId);
    if (!claimed) {
      // Another delivery won the race, or the intent is no longer payable.
      intent = (await findIntentByQrId(env.DB, qrId)) ?? intent;
    } else {
      intent = {
        ...intent,
        status: 'paid',
        razorpay_payment_id: paymentId,
        paid_at: new Date().toISOString(),
      };
    }
  }

  if (intent.status !== 'paid') {
    return jsonResponse(request, env, { ok: true, ignored: `intent_${intent.status}` });
  }

  if (intent.razorpay_payment_id && intent.razorpay_payment_id !== paymentId) {
    console.error(
      `Razorpay webhook: intent ${intent.id} already paid by ${intent.razorpay_payment_id}, got ${paymentId}`,
    );
    return jsonResponse(request, env, { ok: true, ignored: 'already_paid' });
  }

  if (intent.fulfilled_at) {
    await recordWebhookEvent(env.DB, { id: eventId, type: 'qr_code.credited' });
    return jsonResponse(request, env, { ok: true, duplicate: true });
  }

  await fulfilIntent(env.DB, intent, { id: eventId, type: 'qr_code.credited' });
  return jsonResponse(request, env, { ok: true });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
