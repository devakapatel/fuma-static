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

    const body = await request.json();
    const { messages } = body;

    console.log('Received messages:', JSON.stringify(messages, null, 2));

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array required and must not be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert AI SDK message format to standard OpenAI format
    // AI SDK messages have: { id, role, parts: [{ type: 'text', text: '...' }] }
    // OpenAI expects: { role: 'user', content: '...' }
    const formattedMessages = messages.map((msg: any) => {
      if (msg.content) {
        // Already in OpenAI format
        return { role: msg.role, content: msg.content };
      }
      if (msg.parts && Array.isArray(msg.parts)) {
        // AI SDK format - extract text from parts
        const text = msg.parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('');
        return { role: msg.role, content: text };
      }
      // Fallback
      return { role: msg.role, content: '' };
    }).filter((msg: any) => msg.content && msg.content.trim().length > 0);

    console.log('Formatted messages:', JSON.stringify(formattedMessages, null, 2));

    if (formattedMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid messages with content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Use AI SDK's streamText with OpenAI provider - this handles the UI message stream format automatically
    const openai = createOpenAI({
      baseURL: env.CHAT_ENDPOINT,
      apiKey: 'not-needed',
    });

    const result = streamText({
      model: openai(env.CHAT_MODEL),
      messages: formattedMessages,
      temperature: 0.7,
      maxTokens: 1000,
    });

    // Return UI message stream response - this produces the format the AI SDK client expects
    return result.toUIMessageStreamResponse({
      headers: {
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