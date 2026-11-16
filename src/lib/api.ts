/**
 * Base URL for Cloudflare Pages Functions.
 *
 * Leave unset in production: the site and `/api/*` live on the same origin, so
 * relative URLs keep the session cookie same-origin. Set it only when running
 * `next dev` against a separate `wrangler pages dev` instance.
 */
export const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}
