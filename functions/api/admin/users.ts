import { hashPassword, isAdmin } from '../../_lib/auth';
import { jsonResponse, optionsResponse } from '../../_lib/http';
import {
  createUser,
  findUserByUsername,
  isValidPassword,
  isValidUsername,
  listUsers,
  normalizeUsername,
  setPaidUntil,
  setUserPassword,
  toPublicUser,
} from '../../_lib/users';
import type { Env, PagesFunction } from '../../_lib/types';

function unauthorized(request: Request, env: Env): Response {
  if (!env.ADMIN_TOKEN) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }
  return jsonResponse(request, env, { error: 'unauthorized' }, 401);
}

function parsePaidUntil(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdmin(request, env)) return unauthorized(request, env);

  const users = await listUsers(env.DB);
  return jsonResponse(request, env, { users: users.map(toPublicUser) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdmin(request, env)) return unauthorized(request, env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const { username, password, paidUntil } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
    paidUntil?: unknown;
  };

  if (typeof username !== 'string' || typeof password !== 'string') {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const normalized = normalizeUsername(username);
  if (!isValidUsername(normalized)) {
    return jsonResponse(request, env, { error: 'invalid_username' }, 400);
  }
  if (!isValidPassword(password)) {
    return jsonResponse(request, env, { error: 'invalid_password' }, 400);
  }

  const parsedPaidUntil = parsePaidUntil(paidUntil ?? null);
  if (parsedPaidUntil === undefined) {
    return jsonResponse(request, env, { error: 'invalid_paid_until' }, 400);
  }

  const existing = await findUserByUsername(env.DB, normalized);
  if (existing) {
    return jsonResponse(request, env, { error: 'username_taken' }, 409);
  }

  const user = await createUser(env.DB, {
    username: normalized,
    passwordHash: await hashPassword(password),
    paidUntil: parsedPaidUntil,
  });

  return jsonResponse(request, env, { user: toPublicUser(user) }, 201);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdmin(request, env)) return unauthorized(request, env);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const payload = (body ?? {}) as { username?: unknown; password?: unknown; paidUntil?: unknown };
  if (typeof payload.username !== 'string') {
    return jsonResponse(request, env, { error: 'invalid_request' }, 400);
  }

  const normalized = normalizeUsername(payload.username);
  const user = await findUserByUsername(env.DB, normalized);
  if (!user) {
    return jsonResponse(request, env, { error: 'user_not_found' }, 404);
  }

  if (payload.password !== undefined) {
    if (typeof payload.password !== 'string' || !isValidPassword(payload.password)) {
      return jsonResponse(request, env, { error: 'invalid_password' }, 400);
    }
    await setUserPassword(env.DB, normalized, await hashPassword(payload.password));
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'paidUntil')) {
    const parsedPaidUntil = parsePaidUntil(payload.paidUntil);
    if (parsedPaidUntil === undefined) {
      return jsonResponse(request, env, { error: 'invalid_paid_until' }, 400);
    }
    await setPaidUntil(env.DB, normalized, parsedPaidUntil);
  }

  const updated = await findUserByUsername(env.DB, normalized);
  return jsonResponse(request, env, { user: updated ? toPublicUser(updated) : null });
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => optionsResponse(request, env);
