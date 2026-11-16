import {
  buildSessionCookie,
  createSessionToken,
  verifyPassword,
} from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  clearLoginAttempts,
  findUserByEmail,
  isLoginRateLimited,
  isValidEmail,
  normalizeEmail,
  recordFailedLogin,
  toPublicUser,
} from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || password.length === 0) {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return jsonResponse(request, env, { error: 'invalid_credentials' }, 401);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateKey = `${normalized}:${ip}`;

  if (await isLoginRateLimited(env.DB, rateKey)) {
    return jsonResponse(request, env, { error: 'too_many_attempts' }, 429);
  }

  const user = await findUserByEmail(env.DB, normalized);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;

  if (!user || !valid) {
    if (user) await recordFailedLogin(env.DB, rateKey);
    return jsonResponse(request, env, { error: 'invalid_credentials' }, 401);
  }

  await clearLoginAttempts(env.DB, rateKey);
  const token = await createSessionToken(user, env.SESSION_SECRET);

  return jsonResponse(
    request,
    env,
    { user: toPublicUser(user) },
    200,
    { 'Set-Cookie': buildSessionCookie(request, token) },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
