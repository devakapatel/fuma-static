import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { z } from 'zod';

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
  SITE_URL?: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

// Search the existing ZBSearch API
async function searchDocs(siteUrl: string, query: string, limit: number = 5) {
  const response = await fetch(`${siteUrl}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  const data = await response.json();
  
  const docsObj = data.docs?.docs || {};
  const docsArray = Object.values(docsObj);
  
  return docsArray
    .slice(0, limit)
    .map((doc: any, idx: number) => ({
      title: doc.title || 'Untitled',
      url: doc.url || '',
      content: doc.content || '',
      score: doc._score || 0,
    }))
    .filter((r: any) => r.content && r.content.length > 0);
}

// Fetch page markdown content
async function fetchPageMarkdown(siteUrl: string, slug: string): Promise<string> {
  const cleanSlug = slug.startsWith('/') ? slug.slice(1) : slug;
  const url = `${siteUrl}/llms.mdx/docs/${cleanSlug}/content.md`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status}`);
  }
  return await response.text();
}

const systemPrompt = `You are an AI assistant for a documentation site. 
You have access to the documentation content through search results provided in the context.
Ground your answers in the documentation and cite sources with URLs.
If you cannot find the answer in the provided context, say you don't know and suggest a better search query.`;

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
  SITE_URL?: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return new Response(
    JSON.stringify({
      CHAT_ENDPOINT: env.CHAT_ENDPOINT ? 'SET' : 'MISSING',
      CHAT_MODEL: env.CHAT_MODEL ? 'SET' : 'MISSING',
      SITE_URL: env.SITE_URL ? 'SET' : 'MISSING',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.CHAT_ENDPOINT || !env.CHAT_MODEL) {
      console.error('Missing required env vars: CHAT_ENDPOINT, CHAT_MODEL');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: missing CHAT_ENDPOINT or CHAT_MODEL' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const siteUrl = env.SITE_URL || 'https://fuma-static.pages.dev';

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
    const formattedMessages = messages.map((msg: any) => {
      if (msg.content) {
        return { role: msg.role, content: msg.content };
      }
      if (msg.parts && Array.isArray(msg.parts)) {
        const text = msg.parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('');
        return { role: msg.role, content: text };
      }
      return { role: msg.role, content: '' };
    }).filter((msg: any) => msg.content && msg.content.trim().length > 0);

    console.log('Formatted messages:', JSON.stringify(formattedMessages, null, 2));

    if (formattedMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid messages with content' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the user's last message for search
    const lastUserMessage = formattedMessages
      .filter(m => m.role === 'user')
      .pop();

    // Do search upfront based on the user's question
    let searchContext = '';
    if (lastUserMessage) {
      try {
        const searchResults = await searchDocs(siteUrl, lastUserMessage.content, 5);
        if (searchResults.length > 0) {
          searchContext = '\n\n--- Documentation Search Results ---\n';
          searchResults.forEach((result, idx) => {
            searchContext += `\n[${idx + 1}] ${result.title} (${result.url})\n${result.content}\n`;
          });
        }
      } catch (error) {
        console.error('Search error:', error);
      }
    }

    const systemPrompt = `You are an AI assistant for a documentation site. 
You have access to the documentation content through search results provided in the context.
Ground your answers in the documentation and cite sources with URLs.
If you cannot find the answer in the provided context, say you don't know and suggest a better search query.
${searchContext}`;

    const openai = createOpenAI({
      baseURL: env.CHAT_ENDPOINT,
      apiKey: 'not-needed',
    });

    const result = streamText({
      model: createOpenAI({
        baseURL: env.CHAT_ENDPOINT,
        apiKey: 'not-needed',
      })(env.CHAT_MODEL),
      system: systemPrompt,
      messages: formattedMessages,
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