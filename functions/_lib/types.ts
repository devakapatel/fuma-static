// Minimal Cloudflare bindings used by the Pages Functions.
// Kept local so the Next.js typecheck does not need @cloudflare/workers-types.

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ADMIN_TOKEN: string;
  SITE_URL?: string;
  ALLOWED_ORIGIN?: string;
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
}

export interface PagesFunction<E = Env> {
  (args: {
    request: Request;
    env: E;
    ctx: { waitUntil: (promise: Promise<unknown>) => void };
  }): Promise<Response> | Response;
}
