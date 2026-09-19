import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return new Response(
    JSON.stringify({
      CHAT_ENDPOINT: env.CHAT_ENDPOINT ? 'SET' : 'MISSING',
      CHAT_MODEL: env.CHAT_MODEL ? 'SET' : 'MISSING',
      CHAT_ENDPOINT_VALUE: env.CHAT_ENDPOINT,
      CHAT_MODEL_VALUE: env.CHAT_MODEL,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // Validate environment variables
    if (!env.CHAT_ENDPOINT || !env.CHAT_MODEL) {
      console.error('Missing required env vars: CHAT_ENDPOINT, CHAT_MODEL');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: missing CHAT_ENDPOINT or CHAT_MODEL' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('CHAT_ENDPOINT:', env.CHAT_ENDPOINT);
    console.log('CHAT_MODEL:', env.CHAT_MODEL);

    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Call the upstream API directly to see the actual error
    const upstreamResponse = await fetch(env.CHAT_ENDPOINT + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.CHAT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: true,
      }),
    });

    console.log('Upstream response status:', upstreamResponse.status);
    console.log('Upstream response headers:', Object.fromEntries(upstreamResponse.headers.entries()));

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      console.error('Upstream error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Upstream API error', status: upstreamResponse.status, details: errorText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the response back
    return new Response(upstreamResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    const errorDetails = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : { error: String(error), type: typeof error };
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorDetails }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};