import type { Env } from './types';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const encoder = new TextEncoder();

export interface RazorpayQr {
  id: string;
  image_url: string | null;
  close_by: number | null;
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

export async function closeUpiQr(env: Env, qrId: string): Promise<void> {
  await razorpayRequest(env, `/payments/qr_codes/${encodeURIComponent(qrId)}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function createUpiQr(
  env: Env,
  input: {
    amount: number;
    name: string;
    description: string;
    closeBy: number;
    notes: Record<string, string>;
  },
): Promise<RazorpayQr> {
  const data = (await razorpayRequest(env, '/payments/qr_codes', {
    method: 'POST',
    body: JSON.stringify({
      type: 'upi_qr',
      name: input.name.slice(0, 40),
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: input.amount,
      description: input.description.slice(0, 255),
      close_by: input.closeBy,
      notes: input.notes,
    }),
  })) as Partial<RazorpayQr> | null;

  if (!data || typeof data.id !== 'string') {
    throw new Error('Razorpay returned an invalid QR response');
  }

  return {
    id: data.id,
    image_url: typeof data.image_url === 'string' ? data.image_url : null,
    close_by: typeof data.close_by === 'number' ? data.close_by : null,
  };
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
