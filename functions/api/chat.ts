import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response('Invalid request: messages array required', { status: 400 });
    }

    const openai = createOpenAI({
      baseURL: env.CHAT_ENDPOINT,
      apiKey: 'not-needed',
    });

    const result = streamText({
      model: openai(env.CHAT_MODEL),
      messages,
      temperature: 0.7,
    });

    return result.toUIMessageStreamResponse({
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response('Internal server error', { status: 500 });
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