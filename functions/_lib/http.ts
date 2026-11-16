import type { Env } from './types';

/** Reflect the request origin only when it is explicitly allowed. */
export function corsHeaders(
  request: Request,
  env: Pick<Env, 'SITE_URL' | 'ALLOWED_ORIGIN'>,
): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN ?? (env.SITE_URL ? safeOrigin(env.SITE_URL) : undefined);

  if (origin && allowed && origin === allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  return headers;
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function jsonResponse(
  request: Request,
  env: Pick<Env, 'SITE_URL' | 'ALLOWED_ORIGIN'>,
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function optionsResponse(
  request: Request,
  env: Pick<Env, 'SITE_URL' | 'ALLOWED_ORIGIN'>,
): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
