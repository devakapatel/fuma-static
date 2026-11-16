import { authenticateRequest } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  claimIntentPaid,
  findIntentById,
  findIntentForUser,
  fulfilIntent,
  toPublicIntent,
} from '../../_lib/payments';
import { fetchPaymentLink, razorpayConfigured } from '../../_lib/razorpay';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  let row = await findIntentForUser(env.DB, id, auth.user.id);
  if (!row) {
    return jsonResponse(request, env, { error: 'not_found' }, 404);
  }

  // The webhook is authoritative, but reconciling against Razorpay keeps the
  // dialog working when a delivery is delayed or the webhook is not set up.
  const shouldReconcile =
    url.searchParams.get('reconcile') === '1' &&
    row.status === 'created' &&
    Boolean(row.razorpay_link_id) &&
    razorpayConfigured(env);

  if (shouldReconcile && row.razorpay_link_id) {
    try {
      const link = await fetchPaymentLink(env, row.razorpay_link_id);
      if (link.status === 'paid') {
        const payment =
          link.payments?.find(
            (entry) => entry.status === 'captured' || entry.status === 'authorized',
          ) ?? link.payments?.[0];

        if (payment?.payment_id) {
          await claimIntentPaid(env.DB, row.id, payment.payment_id);
          const afterClaim = await findIntentById(env.DB, row.id);
          if (afterClaim) {
            row = afterClaim;
            if (afterClaim.status === 'paid' && !afterClaim.fulfilled_at) {
              await fulfilIntent(env.DB, afterClaim, {
                id: `link:${payment.payment_id}`,
                type: 'payment_link.paid',
              });
              row = (await findIntentById(env.DB, row.id)) ?? row;
            }
          }
        }
      }
    } catch (error) {
      console.error('Could not reconcile Payment Link status:', error);
    }
  }

  return jsonResponse(request, env, { intent: toPublicIntent(row) });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
