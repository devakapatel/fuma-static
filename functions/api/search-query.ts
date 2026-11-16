// Queries the static ZBSearch index served by the Next.js static export
// at /api/search. The index is loaded once per isolate and cached in
// global scope — it holds only the search index, not full page content.
//
// This endpoint is part of the paid AI feature: chat forwards the signed-in
// user's session cookie so anonymous callers cannot use the index.

import { create, load, search } from 'zbsearch';
import { authenticateRequest, isPaid } from '../_lib/auth';
import { jsonResponse, optionsResponse } from '../_lib/http';
import type { Env, PagesFunction } from '../_lib/types';

interface CachedDB {
  promise: Promise<unknown>;
}

const globalCache = globalThis as unknown as { __docsSearchDB?: CachedDB };

function getDB(siteUrl: string): Promise<unknown> {
  if (!globalCache.__docsSearchDB) {
    globalCache.__docsSearchDB = {
      promise: (async () => {
        const res = await fetch(`${siteUrl}/api/search`);
        if (!res.ok) throw new Error(`Failed to load search index: ${res.status}`);
        const data = await res.json();
        const db = create({
          schema: { _: 'string' },
        });
        load(db, data);
        return db;
      })(),
    };
  }
  return globalCache.__docsSearchDB.promise;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET) {
    return jsonResponse(request, env, { error: 'server_misconfigured' }, 500);
  }

  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
  }
  if (!isPaid(auth.user)) {
    return jsonResponse(request, env, { error: 'payment_required' }, 403);
  }

  const siteUrl = env.SITE_URL || 'https://t9.pages.dev';
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const requestedLimit = Number(url.searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 20)
    : 10;

  if (!q || q.trim().length === 0) {
    return jsonResponse(request, env, { error: 'Missing "q" query parameter' }, 400);
  }

  try {
    const db = await getDB(siteUrl);
    // @ts-expect-error — zbsearch DB is generic; search accepts it at runtime
    const results = await search(db, q, { limit, merge: true, enrich: true });

    // Normalize ZBSearch enriched results into a flat shape for the AI
    const hits = (Array.isArray(results) ? results : results.hits ?? []).map(
      (hit: any) => {
        const doc = hit.document ?? hit.doc ?? hit;
        return {
          title: doc.title ?? hit.title ?? 'Untitled',
          url: doc.url ?? hit.url ?? doc.id ?? hit.id ?? '',
          content: doc.content ?? hit.content ?? '',
          score: hit.score ?? doc._score ?? 0,
        };
      },
    );

    return jsonResponse(request, env, { query: q, results: hits });
  } catch (error) {
    return jsonResponse(
      request,
      env,
      {
        error: 'Search failed',
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
