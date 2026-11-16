import type { D1Database } from './types';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  paid_until: string | null;
  session_version: number;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  email: string;
  paid: boolean;
  paidUntil: string | null;
  createdAt: string;
}

const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 200;
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    email: user.email,
    paid: Boolean(user.paid_until) && Date.parse(user.paid_until as string) > Date.now(),
    paidUntil: user.paid_until,
    createdAt: user.created_at,
  };
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const result = await db.prepare('SELECT * FROM users ORDER BY created_at DESC').all<UserRow>();
  return result.results ?? [];
}

export async function createUser(
  db: D1Database,
  input: { email: string; passwordHash: string; paidUntil: string | null },
): Promise<UserRow> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, paid_until, session_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.email, input.passwordHash, input.paidUntil, now, now)
    .run();

  const user = await findUserById(db, id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function setUserPassword(db: D1Database, email: string, passwordHash: string): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET password_hash = ?, session_version = session_version + 1, updated_at = ?
       WHERE email = ?`,
    )
    .bind(passwordHash, new Date().toISOString(), email)
    .run();
}

export async function setPaidUntil(
  db: D1Database,
  email: string,
  paidUntil: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE users SET paid_until = ?, updated_at = ? WHERE email = ?')
    .bind(paidUntil, new Date().toISOString(), email)
    .run();
}

// ---------- login rate limiting ----------

export async function isLoginRateLimited(db: D1Database, key: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT count, reset_at FROM login_attempts WHERE key = ?')
    .bind(key)
    .first<{ count: number; reset_at: string }>();

  if (!row) return false;
  if (Date.parse(row.reset_at) <= Date.now()) {
    await clearLoginAttempts(db, key);
    return false;
  }
  return row.count >= LOGIN_MAX_ATTEMPTS;
}

export async function recordFailedLogin(db: D1Database, key: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const resetAt = new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO login_attempts (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.count + 1 END,
         reset_at = CASE WHEN login_attempts.reset_at <= ? THEN excluded.reset_at ELSE login_attempts.reset_at END`,
    )
    .bind(key, resetAt, nowIso, nowIso)
    .run();
}

export async function clearLoginAttempts(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
}
