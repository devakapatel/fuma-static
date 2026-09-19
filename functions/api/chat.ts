import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
  SITE_URL?: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

// Cache for the docs content
let docsContentCache: string | null = null;
let docsContentCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getDocsContent(env: Env): Promise<string> {
  const now = Date.now();
  if (docsContentCache && (now - docsContentCacheTime) < CACHE_TTL) {
    return docsContentCache;
  }

  // Use the Pages deployment URL for docs content
  // This should be set as an env var, fallback to the known Pages URL
  const siteUrl = env.SITE_URL || 'https://fuma-static.pages.dev';
  const response = await fetch(`${siteUrl}/llms-full.txt`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch docs content: ${response.status}`);
  }
  
  docsContentCache = await response.text();
  docsContentCacheTime = now;
  return docsContentCache;
}

function searchDocs(content: string, query: string, limit: number = 5): Array<{ title: string; url: string; content: string }> {
  const results: Array<{ title: string; url: string; content: string; score: number }> = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);
  
  // Split content by pages (each page starts with # Title (url))
  const pages = content.split(/^# /m).slice(1); // Split by "# " at start of line
  
  for (const page of pages) {
    const lines = page.split('\n');
    if (lines.length === 0) continue;
    
    // First line is "Title (url)"
    const headerMatch = lines[0].match(/^(.+?) \((.+?)\)$/);
    if (!headerMatch) continue;
    
    const title = headerMatch[1].trim();
    const url = headerMatch[1].trim(); // fallback
    const urlMatch = lines[0].match(/\((.+?)\)$/);
    const pageUrl = urlMatch ? urlMatch[1] : '';
    
    const pageContent = lines.slice(1).join('\n').trim();
    const pageContentLower = pageContent.toLowerCase();
    
    // Score based on query term matches
    let score = 0;
    for (const term of queryTerms) {
      // Count occurrences in content
      const contentMatches = (pageContentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      score += contentMatches * 2;
      
      // Bonus for title matches
      if (title.toLowerCase().includes(term)) {
        score += 5;
      }
    }
    
    if (score > 0) {
      // Extract relevant snippet
      const snippetStart = Math.max(0, pageContentLower.indexOf(queryTerms[0] || '') - 100);
      const snippet = pageContent.substring(snippetStart, snippetStart + 300);
      
      results.push({
        title,
        url: pageUrl,
        content: snippet,
        score
      });
    }
  }
  
  // Sort by score and return top results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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

    // Get docs content for search tool
    let docsContent: string;
    try {
      docsContent = await getDocsContent(env);
    } catch (e) {
      console.error('Failed to fetch docs content:', e);
      docsContent = '';
    }

    // Define search tool
    const searchTool = tool({
      description: 'Search the documentation for relevant content',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of results'),
      }),
      execute: async ({ query, limit = 5 }) => {
        console.log('Search tool called with query:', query);
        if (!docsContent) {
          return { results: [], error: 'Documentation content not available' };
        }
        const results = searchDocs(docsContent, query, limit);
        console.log('Search results:', results.length, 'items found for query:', query);
        return { results };
      },
    });

    // Use AI SDK's streamText with OpenAI provider
    const openai = createOpenAI({
      baseURL: env.CHAT_ENDPOINT,
      apiKey: 'not-needed',
    });

    const systemPrompt = `You are an AI assistant for a documentation site. 
You MUST use the search tool to retrieve relevant documentation context before answering any question.
Do not answer from general knowledge - always search the documentation first.
The search tool returns relevant documentation snippets with URLs. Use those results to ground your answer and cite sources as markdown links using the document URL field when available.
If you cannot find the answer in search results, say you do not know and suggest a better search query.`;

    const result = streamText({
      model: createOpenAI({
        baseURL: env.CHAT_ENDPOINT,
        apiKey: 'not-needed',
      })(env.CHAT_MODEL),
      system: systemPrompt,
      messages: formattedMessages,
      temperature: 0.7,
      tools: {
        search: searchTool,
      },
      toolChoice: 'auto',
      maxSteps: 5,
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