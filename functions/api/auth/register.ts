import {
  buildSessionCookie,
  createSessionToken,
  hashPassword,
} from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  createUser,
  findUserByEmail,
  isLoginRateLimited,
  isValidEmail,
  isValidPassword,
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
  if (typeof email !== 'string' || typeof password !== 'string') {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return jsonResponse(request, env, { error: 'invalid_email' }, 400);
  }
  if (!isValidPassword(password)) {
    return jsonResponse(request, env, { error: 'invalid_password' }, 400);
  }

  // Reuse the login throttle table as a per-IP registration limit.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateKey = `register:${ip}`;
  if (await isLoginRateLimited(env.DB, rateKey)) {
    return jsonResponse(request, env, { error: 'too_many_attempts' }, 429);
  }

  if (await findUserByEmail(env.DB, normalized)) {
    await recordFailedLogin(env.DB, rateKey);
    return jsonResponse(request, env, { error: 'email_taken' }, 409);
  }

  let user;
  try {
    user = await createUser(env.DB, {
      email: normalized,
      passwordHash: await hashPassword(password),
      paidUntil: null,
    });
  } catch {
    // A concurrent sign-up may have won the UNIQUE(email) race.
    if (await findUserByEmail(env.DB, normalized)) {
      await recordFailedLogin(env.DB, rateKey);
      return jsonResponse(request, env, { error: 'email_taken' }, 409);
    }
    return jsonResponse(request, env, { error: 'server_error' }, 500);
  }

  // Count successful sign-ups against the same window so one IP can't mass-create accounts.
  await recordFailedLogin(env.DB, rateKey);

  const token = await createSessionToken(user, env.SESSION_SECRET);
  return jsonResponse(
    request,
    env,
    { user: toPublicUser(user) },
    201,
    { 'Set-Cookie': buildSessionCookie(request, token) },
  );
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
