// Queries the static ZBSearch index served by the Next.js static export
// at /api/search. The index is loaded once per isolate and cached in
// global scope — it holds only the search index, not full page content.

import { create, load, search } from 'zbsearch';

interface Env {
  SITE_URL?: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

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
  const siteUrl = env.SITE_URL || 'https://fuma-static.pages.dev';
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const limit = Number(url.searchParams.get('limit') ?? '10');

  if (!q || q.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Missing "q" query parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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

    return new Response(JSON.stringify({ query: q, results: hits }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Search failed',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
