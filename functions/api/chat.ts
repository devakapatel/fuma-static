// AI chat backend for Cloudflare Pages Functions.
//
// Architecture (scales to hundreds of long pages — no in-memory corpus):
//  - search_docs tool -> /api/search-query (static ZBSearch index, loaded
//    once per isolate, index-only footprint)
//  - read_page tool   -> /llms.mdx/[...slug]/content.md (static md),
//    split into sections by `## ` headings so the model can pull only
//    what it needs
//  - current page -> injected up front but truncated, with a pointer to
//    read_page for the rest
//
// The model decides what to fetch via tool calls (bounded by maxSteps).

import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, stepCountIs, convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt, chatTemperature, maxHistoryMessages } from '../../src/lib/ai-prompt';
import { authenticateRequest, isPaid } from '../_lib/auth';
import { corsHeaders, jsonResponse, optionsResponse } from '../_lib/http';
import type { Env, PagesFunction } from '../_lib/types';

const MAX_CURRENT_PAGE_CHARS = 6000;
const MAX_SECTION_CHARS = 6000;
const MAX_STEP_COUNT = 6;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB request body cap

// ---------- search_docs ----------

interface SearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
}

async function searchDocs(
  siteUrl: string,
  query: string,
  limit: number,
  cookie: string | null,
): Promise<SearchHit[]> {
  const res = await fetch(
    `${siteUrl}/api/search-query?q=${encodeURIComponent(query)}&limit=${limit}`,
    // Forward the signed-in user's session so the search endpoint stays gated too.
    cookie ? { headers: { Cookie: cookie } } : undefined,
  );
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = (await res.json()) as { results?: SearchHit[] };
  // Return title/url/snippet only — keep tool output small
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content.slice(0, 300),
    score: r.score,
  }));
}

// ---------- read_page (sections on demand) ----------

interface PageSection {
  index: number;
  heading: string;
  chars: number;
}

function splitSections(markdown: string): PageSection[] {
  const lines = markdown.split('\n');
  const sections: PageSection[] = [];
  let heading = '(introduction)';
  let buffer: string[] = [];
  let index = 0;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) sections.push({ index: index++, heading, chars: text.length });
    buffer = [];
  };

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
      heading = line.replace(/^##\s+/, '').trim();
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

async function fetchPageMarkdown(siteUrl: string, slug: string): Promise<string> {
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
  const res = await fetch(`${siteUrl}/llms.mdx/${cleanSlug}/content.md`);
  if (!res.ok) throw new Error(`Failed to fetch page '${slug}': ${res.status}`);
  return res.text();
}

function pageUrlFromSlug(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '').replace(/(^|\/)index$/, '');
  return `/${clean}`;
}

// ---------- health check ----------

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return jsonResponse(request, env, {
    CHAT_ENDPOINT: env.CHAT_ENDPOINT ? 'SET' : 'MISSING',
    CHAT_MODEL: env.CHAT_MODEL ? 'SET' : 'MISSING',
    SITE_URL: env.SITE_URL ? 'SET' : 'MISSING',
    DB: env.DB ? 'SET' : 'MISSING',
    SESSION_SECRET: env.SESSION_SECRET ? 'SET' : 'MISSING',
  });
};

// ---------- chat ----------

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB || !env.SESSION_SECRET) {
      return jsonResponse(
        request,
        env,
        { error: 'Server configuration error: missing DB or SESSION_SECRET' },
        500,
      );
    }

    // AI is for paid members only. Enforced here, not in the UI.
    const auth = await authenticateRequest(request, env);
    if (!auth.user) {
      return jsonResponse(request, env, { error: 'unauthenticated' }, 401);
    }
    if (!isPaid(auth.user)) {
      return jsonResponse(
        request,
        env,
        { error: 'payment_required', paidUntil: auth.user.paid_until },
        403,
      );
    }

    if (!env.CHAT_ENDPOINT) {
      return jsonResponse(
        request,
        env,
        { error: 'Server configuration error: missing CHAT_ENDPOINT' },
        500,
      );
    }

    const siteUrl = env.SITE_URL || 'https://t9.pages.dev';

    // request guards: body size and history length
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse(request, env, { error: 'Request body too large' }, 413);
    }

    const body = await request.json();
    let uiMessages = body.messages;

    if (!Array.isArray(uiMessages) || uiMessages.length === 0) {
      return jsonResponse(
        request,
        env,
        { error: 'Invalid request: messages array required and must not be empty' },
        400,
      );
    }
    uiMessages = uiMessages.slice(-maxHistoryMessages);

    // Fixed model - no user selection, no per-request override.
    const model = env.CHAT_MODEL || 'kilo-auto/free';

    // Current page URL, sent by the client as a `data-client` part
    const clientLocation: string | undefined = uiMessages
      .at(-1)
      ?.parts?.find((p: { type?: string }) => p.type === 'data-client')?.data?.location;

    let currentPageContext = '';
    if (clientLocation) {
      try {
        const path = new URL(clientLocation, siteUrl).pathname;
        // docs pages live at root-level slugs; skip known non-docs paths
        const isDocsPage =
          path !== '/' &&
          !path.startsWith('/api') &&
          !path.startsWith('/llms') &&
          !path.startsWith('/og');
        if (isDocsPage) {
          const slug = path.replace(/^\/+|\/+$/g, '') || 'index';
          const markdown = await fetchPageMarkdown(siteUrl, slug);
          const truncated =
            markdown.length > MAX_CURRENT_PAGE_CHARS
              ? `${markdown.slice(0, MAX_CURRENT_PAGE_CHARS)}\n\n[... page truncated, ${markdown.length} chars total. Use the read_page tool to see specific sections.]`
              : markdown;
          currentPageContext = `The user is currently viewing: ${pageUrlFromSlug(slug)}\n\n${truncated}`;
        }
      } catch (error) {
        console.error('Current page fetch error:', error);
      }
    }

    const systemPrompt = [
      buildSystemPrompt({ search: 'search_docs', readPage: 'read_page' }),
      currentPageContext ? `\n\n# Current Page\n\n${currentPageContext}` : '',
    ].join('');

    const result = streamText({
      model: createOpenAI({
        baseURL: env.CHAT_ENDPOINT,
        // The gateway is auth-less, but it strictly validates any bearer token
        // it receives (401 INVALID_TOKEN). `apiKey` must stay a non-empty
        // string (the SDK otherwise throws "API key is missing"), so we
        // override Authorization with an empty string to send no credentials.
        apiKey: 'not-needed',
        headers: { Authorization: '' },
      })(model),
      system: systemPrompt,
      messages: await convertToModelMessages(uiMessages, {
        convertDataPart(part) {
          if (part.type === 'data-client') {
            return {
              type: 'text',
              text: `[Client Context: ${JSON.stringify(part.data)}]`,
            };
          }
        },
      }),
      stopWhen: stepCountIs(MAX_STEP_COUNT),
      tools: {
        search_docs: tool({
          description: 'Search the documentation. Returns page titles, URLs and short snippets. Use read_page to get full content of a promising result.',
          inputSchema: z.object({
            query: z.string().describe('The search query'),
            limit: z.number().int().min(1).max(20).default(5).describe('Max results to return'),
          }),
          execute: async ({ query, limit }) =>
            searchDocs(siteUrl, query, limit, request.headers.get('Cookie')),
        }),
        read_page: tool({
          description: 'Read a documentation page as markdown. Without section, returns the table of sections (headings + sizes) plus the first part; pass a section index to read one section in full.',
          inputSchema: z.object({
            slug: z.string().describe('Page slug, e.g. "test" or "index" for the docs root'),
            section: z.number().int().min(0).optional().describe('Index of the section to read (from the section list)'),
          }),
          execute: async ({ slug, section }) => {
            const markdown = await fetchPageMarkdown(siteUrl, slug);
            const sections = splitSections(markdown);

            if (section === undefined) {
              return {
                url: pageUrlFromSlug(slug),
                totalChars: markdown.length,
                sections,
                preview: markdown.slice(0, MAX_SECTION_CHARS),
              };
            }

            // Re-split keeping content, then return the requested one
            const lines = markdown.split('\n');
            const chunks: { heading: string; text: string[] }[] = [];
            let heading = '(introduction)';
            let buffer: string[] = [];
            for (const line of lines) {
              if (/^##\s+/.test(line)) {
                chunks.push({ heading, text: buffer });
                heading = line.replace(/^##\s+/, '').trim();
                buffer = [];
              }
              buffer.push(line);
            }
            chunks.push({ heading, text: buffer });

            const picked = chunks[section];
            if (!picked) return { error: `Section ${section} not found. Available sections: 0..${chunks.length - 1}` };

            const text = picked.text.join('\n').trim();
            return {
              url: pageUrlFromSlug(slug),
              heading: picked.heading,
              truncated: text.length > MAX_SECTION_CHARS,
              content: text.slice(0, MAX_SECTION_CHARS),
            };
          },
        }),
      },
      toolChoice: 'auto',
      temperature: chatTemperature,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
      headers: corsHeaders(request, env),
    });
  } catch (error) {
    console.error('Chat error:', error);
    return jsonResponse(
      request,
      env,
      {
        error: 'Internal server error',
        details: error instanceof Error ? { message: error.message, name: error.name } : String(error),
      },
      500,
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) =>
  optionsResponse(request, env);
