// AI chat backend for Cloudflare Pages Functions.
//
// Architecture (scales to hundreds of long pages — no in-memory corpus):
//  - search_docs tool -> /api/search-query (static ZBSearch index, loaded
//    once per isolate, index-only footprint)
//  - read_page tool   -> /llms.mdx/docs/[...slug]/content.md (static md),
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

interface Env {
  CHAT_ENDPOINT: string;
  CHAT_MODEL: string;
  SITE_URL?: string;
}

interface PagesFunction<Env = unknown> {
  (args: { request: Request; env: Env; ctx: { waitUntil: (promise: Promise<unknown>) => void } }): Promise<Response> | Response;
}

const MAX_CURRENT_PAGE_CHARS = 6000;
const MAX_SECTION_CHARS = 6000;
const MAX_STEP_COUNT = 6;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB request body cap

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // CORS on ALL responses — errors from the static site must not
      // surface as opaque CORS failures in the browser
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// ---------- search_docs ----------

interface SearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
}

async function searchDocs(siteUrl: string, query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch(
    `${siteUrl}/api/search-query?q=${encodeURIComponent(query)}&limit=${limit}`,
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
  const res = await fetch(`${siteUrl}/llms.mdx/docs/${cleanSlug}/content.md`);
  if (!res.ok) throw new Error(`Failed to fetch page '${slug}': ${res.status}`);
  return res.text();
}

function pageUrlFromSlug(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '').replace(/(^|\/)index$/, '');
  return `/docs${clean ? `/${clean}` : ''}`;
}

// ---------- health check ----------

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json({
    CHAT_ENDPOINT: env.CHAT_ENDPOINT ? 'SET' : 'MISSING',
    CHAT_MODEL: env.CHAT_MODEL ? 'SET' : 'MISSING',
    SITE_URL: env.SITE_URL ? 'SET' : 'MISSING',
  });
};

// ---------- chat ----------

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.CHAT_ENDPOINT || !env.CHAT_MODEL) {
      return json({ error: 'Server configuration error: missing CHAT_ENDPOINT or CHAT_MODEL' }, 500);
    }

    const siteUrl = env.SITE_URL || 'https://fuma-static.pages.dev';

    // request guards: body size and history length
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'Request body too large' }, 413);
    }

    const body = await request.json();
    let uiMessages = body.messages;

    if (!Array.isArray(uiMessages) || uiMessages.length === 0) {
      return json({ error: 'Invalid request: messages array required and must not be empty' }, 400);
    }
    uiMessages = uiMessages.slice(-maxHistoryMessages);

    // per-request model override (from the chat panel dropdown).
    // Only free models (":free" suffix) may be selected by clients.
    let model = env.CHAT_MODEL;
    if (typeof body.model === 'string' && body.model.endsWith(':free')) {
      model = body.model;
    } else if (body.model !== undefined && body.model !== null) {
      return json({ error: 'Invalid model: only free models are allowed' }, 400);
    }

    // Current page URL, sent by the client as a `data-client` part
    const clientLocation: string | undefined = uiMessages
      .at(-1)
      ?.parts?.find((p: { type?: string }) => p.type === 'data-client')?.data?.location;

    let currentPageContext = '';
    if (clientLocation) {
      try {
        const path = new URL(clientLocation, siteUrl).pathname;
        const match = path.match(/^\/docs\/?(.*)$/);
        if (match) {
          const slug = match[1] || 'index';
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
        apiKey: 'not-needed',
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
          execute: async ({ query, limit }) => searchDocs(siteUrl, query, limit),
        }),
        read_page: tool({
          description: 'Read a documentation page as markdown. Without section, returns the table of sections (headings + sizes) plus the first part; pass a section index to read one section in full.',
          inputSchema: z.object({
            slug: z.string().describe('Page slug without /docs prefix, e.g. "test" or "" for the docs root'),
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? { message: error.message, name: error.name } : String(error),
      },
      500,
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
