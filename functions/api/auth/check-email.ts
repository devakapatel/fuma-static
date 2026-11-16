import { jsonResponse, optionsResponse } from '../../_lib/http';
import { findUserByEmail, isValidEmail, normalizeEmail } from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const { email } = (body ?? {}) as { email?: unknown };
  if (typeof email !== 'string') {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return jsonResponse(request, env, { error: 'invalid_email' }, 400);
  }

  const user = await findUserByEmail(env.DB, normalized);
  return jsonResponse(request, env, { exists: Boolean(user) });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
