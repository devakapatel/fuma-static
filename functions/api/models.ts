// Lists free chat models available on the configured LLM gateway.
// The model list is fetched from the OpenAI-compatible /models endpoint
// and filtered to free models (id ends with ":free" or isFree === true).
// Cached for 1 hour on the client and at the CDN.

interface Env {
  CHAT_ENDPOINT: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

interface GatewayModel {
  id: string;
  name?: string;
  isFree?: boolean;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.CHAT_ENDPOINT) {
    return new Response(JSON.stringify({ error: 'Server configuration error: missing CHAT_ENDPOINT' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // CHAT_ENDPOINT points to .../v1 — models live at .../models
    const base = env.CHAT_ENDPOINT.replace(/\/+$/, '');
    const res = await fetch(`${base}/models`);
    if (!res.ok) throw new Error(`Models endpoint returned ${res.status}`);

    const data = (await res.json()) as { data?: GatewayModel[] };
    const models = (data.data ?? [])
      .filter((m) => m.isFree === true || m.id?.endsWith(':free'))
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ models }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Failed to load models',
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  }
};
