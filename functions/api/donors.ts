import { jsonResponse, optionsResponse } from '../_lib/http';
import { listPaidDonations } from '../_lib/payments';
import type { Env, PagesFunction } from '../_lib/types';

function isAnonymous(metadata: string | null): boolean {
  if (!metadata) return false;
  try {
    const value = JSON.parse(metadata) as { anonymous?: unknown };
    return value?.anonymous === 'true' || value?.anonymous === true;
  } catch {
    return false;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  const { donors, donationCount, totalAmount } = await listPaidDonations(env.DB);

  return jsonResponse(request, env, {
    donors: donors.map((row) => {
      const anonymous = isAnonymous(row.metadata);
      return {
        // Anonymous donors never expose their email, even though the row
        // still knows it for support and reconciliation.
        id: row.id,
        email: anonymous ? null : row.email,
        amount: row.amount,
        paidAt: row.paid_at,
        anonymous,
      };
    }),
    donationCount,
    totalAmount,
  });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
