import type { Env } from './types';
import { findUserById, type UserRow } from './users';

const encoder = new TextEncoder();
const SESSION_COOKIE = 't9_session';
// Workers rejects PBKDF2 above 100k iterations and the Free plan has a 10ms
// CPU budget per request. 50k keeps login inside that budget; the iteration
// count is stored in each hash, so it can be raised later without breaking users.
const PASSWORD_ITERATIONS = 50_000;
const PASSWORD_KEY_BITS = 256;
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 500_000;

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ---------- encoding ----------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function safeStringEqual(a: string, b: string): boolean {
  return timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

// ---------- passwords ----------

async function derivePassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    PASSWORD_KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Format: pbkdf2$<iterations>$<salt>$<hash>, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split('$');
    if (scheme !== 'pbkdf2' || !saltRaw || !hashRaw) return false;

    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return false;

    const salt = base64UrlToBytes(saltRaw);
    const expected = base64UrlToBytes(hashRaw);
    const actual = await derivePassword(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- sessions ----------

interface SessionPayload {
  uid: string;
  sv: number;
  exp: number;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(signature);
}

export async function createSessionToken(
  user: { id: string; session_version: number },
  secret: string,
): Promise<string> {
  const payload: SessionPayload = {
    uid: user.id,
    sv: user.session_version,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const data = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(secret, data));
  return `${data}.${signature}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const [data, signature] = token.split('.');
    if (!data || !signature) return null;

    const expected = await hmac(secret, data);
    if (!timingSafeEqual(expected, base64UrlToBytes(signature))) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(data))) as SessionPayload;
    if (
      typeof payload.uid !== 'string' ||
      typeof payload.sv !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getSessionToken(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === SESSION_COOKIE) return pair.slice(index + 1).trim();
  }
  return null;
}

export function buildSessionCookie(request: Request, token: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function buildClearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// ---------- request auth ----------

export function isAdmin(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token.length > 0 && safeStringEqual(token, env.ADMIN_TOKEN);
}

export type AuthResult =
  | { user: UserRow; reason: null }
  | { user: null; reason: 'missing' | 'invalid' | 'not_configured' };

export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
  if (!env.SESSION_SECRET) return { user: null, reason: 'not_configured' };

  const token = getSessionToken(request);
  if (!token) return { user: null, reason: 'missing' };

  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) return { user: null, reason: 'invalid' };

  const user = await findUserById(env.DB, payload.uid);
  if (!user || user.session_version !== payload.sv) return { user: null, reason: 'invalid' };

  return { user, reason: null };
}

export function isPaid(user: { paid_until: string | null }): boolean {
  return Boolean(user.paid_until) && Date.parse(user.paid_until as string) > Date.now();
}
