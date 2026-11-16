import type { Env } from './types';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const encoder = new TextEncoder();

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  expire_by: number | null;
  status: string;
}

export interface RazorpayPaymentLinkDetails extends RazorpayPaymentLink {
  amount_paid: number | null;
  payments: Array<{ payment_id: string; status: string; amount: number | null }> | null;
}

export function razorpayConfigured(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function razorpayTestMode(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID?.startsWith('rzp_test_'));
}

function credentials(env: Env): { keyId: string; keySecret: string } {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error('razorpay_not_configured');
  }
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET };
}

async function razorpayRequest(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const { keyId, keySecret } = credentials(env);

  const response = await fetch(`${RAZORPAY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    let providerMessage = `HTTP ${response.status}`;
    if (data && typeof data === 'object' && 'error' in data) {
      const error = (data as { error?: { description?: unknown; reason?: unknown } }).error;
      if (typeof error?.description === 'string') providerMessage = error.description;
      else if (typeof error?.reason === 'string') providerMessage = error.reason;
    }
    const failure = new Error(`Razorpay ${response.status}: ${providerMessage}`);
    (failure as Error & { status?: number }).status = response.status;
    throw failure;
  }

  return data;
}

export async function createPaymentLink(
  env: Env,
  input: {
    amount: number;
    description: string;
    referenceId: string;
    expireBy: number;
    notes: Record<string, string>;
    callbackUrl?: string;
  },
): Promise<RazorpayPaymentLink> {
  const data = (await razorpayRequest(env, '/payment_links/', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      currency: 'INR',
      description: input.description.slice(0, 2048),
      reference_id: input.referenceId.slice(0, 40),
      expire_by: input.expireBy,
      notes: input.notes,
      notify: { sms: false, email: false },
      reminder_enable: false,
      ...(input.callbackUrl
        ? { callback_url: input.callbackUrl, callback_method: 'get' }
        : {}),
    }),
  })) as Partial<RazorpayPaymentLink> | null;

  if (!data || typeof data.id !== 'string' || typeof data.short_url !== 'string') {
    throw new Error('Razorpay returned an invalid Payment Link response');
  }

  return {
    id: data.id,
    short_url: data.short_url,
    expire_by: typeof data.expire_by === 'number' ? data.expire_by : null,
    status: typeof data.status === 'string' ? data.status : 'created',
  };
}

export async function fetchPaymentLink(
  env: Env,
  linkId: string,
): Promise<RazorpayPaymentLinkDetails> {
  const data = (await razorpayRequest(
    env,
    `/payment_links/${encodeURIComponent(linkId)}`,
    { method: 'GET' },
  )) as Partial<RazorpayPaymentLinkDetails> | null;

  if (!data || typeof data.id !== 'string') {
    throw new Error('Razorpay returned an invalid Payment Link response');
  }

  return {
    id: data.id,
    short_url: typeof data.short_url === 'string' ? data.short_url : '',
    expire_by: typeof data.expire_by === 'number' ? data.expire_by : null,
    status: typeof data.status === 'string' ? data.status : 'created',
    amount_paid: typeof data.amount_paid === 'number' ? data.amount_paid : null,
    payments: Array.isArray(data.payments)
      ? data.payments.flatMap((entry) => {
          const candidate = entry as { payment_id?: unknown; status?: unknown; amount?: unknown };
          if (!candidate || typeof candidate.payment_id !== 'string') return [];
          return [
            {
              payment_id: candidate.payment_id,
              status:
                typeof candidate.status === 'string' ? candidate.status : 'captured',
              amount: typeof candidate.amount === 'number' ? candidate.amount : null,
            },
          ];
        })
      : null,
  };
}

export async function cancelPaymentLink(env: Env, linkId: string): Promise<void> {
  await razorpayRequest(env, `/payment_links/${encodeURIComponent(linkId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Razorpay signs the exact raw request body with HMAC-SHA256 using the
 * webhook secret. Never parse and re-stringify the body before checking it.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
