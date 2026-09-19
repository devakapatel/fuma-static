import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
} from 'ai';
import { z } from 'zod';
import { source } from '@/lib/source';
import { Document, type DocumentData } from 'flexsearch';
import { ChatUIMessage, SearchTool } from '../../../components/ai/search';
import { buildSystemPrompt, chatTemperature, maxHistoryMessages } from '@/lib/ai-prompt';

interface CustomDocument extends DocumentData {
  url: string;
  title: string;
  description: string;
  content: string;
}
const searchServer = createSearchServer();

async function createSearchServer() {
  const search = new Document<CustomDocument>({
    document: {
      id: 'url',
      index: ['title', 'description', 'content'],
      store: true,
    },
  });

  const docs = await chunkedAll(
    source.getPages().map(async (page) => {
      if (!('getText' in page.data)) return null;

      return {
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        content: await page.data.getText('processed'),
      } as CustomDocument;
    }),
  );

  for (const doc of docs) {
    if (doc) search.add(doc);
  }

  return search;
}

async function chunkedAll<O>(promises: Promise<O>[]): Promise<O[]> {
  const SIZE = 50;
  const out: O[] = [];
  for (let i = 0; i < promises.length; i += SIZE) {
    out.push(...(await Promise.all(promises.slice(i, i + SIZE))));
  }
  return out;
}

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/** System prompt shared with the production backend (functions/api/chat.ts) */
const systemPrompt = buildSystemPrompt({ search: 'search' });

/**
 * Resolve the docs page the user is currently viewing from their URL,
 * and return its full processed markdown as context.
 *
 * Accepts absolute URLs (https://site/docs/foo) or paths (/docs/foo).
 * Returns null when the URL is not a docs page.
 */
async function getCurrentPageContext(clientUrl: unknown): Promise<string | null> {
  if (typeof clientUrl !== 'string' || clientUrl.length === 0) return null;

  let pathname: string;
  try {
    pathname = new URL(clientUrl).pathname;
  } catch {
    pathname = clientUrl.split('?')[0];
  }

  // docs pages live at root-level slugs (/test, /foo/bar); skip known non-docs paths
  if (
    pathname === '/' ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/llms') ||
    pathname.startsWith('/og')
  ) {
    return null;
  }

  // `/foo/bar` -> `['foo', 'bar']` (the docs "index" page resolves to /index)
  const slugs = pathname
    .split('/')
    .filter((slug) => slug.length > 0);

  const page = source.getPage(slugs);
  if (!page || !('getText' in page.data)) return null;

  const content = await page.data.getText('processed');
  if (!content) return null;

  return `--- Current Page: ${page.data.title} (${page.url}) ---\n${content}\n--- End of Current Page ---`;
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat">) {
  const reqJson = await req.json();

  // cap conversation history sent to the model
  const history = Array.isArray(reqJson.messages) ? reqJson.messages.slice(-maxHistoryMessages) : [];

  // the current page URL sent by the client as a `data-client` part
  const clientLocation = reqJson.messages?.at(-1)?.parts?.find(
    (part: { type?: string }) => part.type === 'data-client',
  )?.data?.location;

  const currentPageContext = await getCurrentPageContext(clientLocation);

  const result = streamText({
    model: openrouter.chat(process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet'),
    temperature: chatTemperature,
    stopWhen: stepCountIs(5),
    tools: {
      search: searchTool,
    },
    messages: [
      {
        role: 'system',
        content: currentPageContext
          ? `${systemPrompt}\n\n# Current Page Context\n\nThe user is currently viewing the page below. Use it directly for questions like "summarize this page" or "explain this".\n\n${currentPageContext}`
          : systemPrompt,
      },
      ...(await convertToModelMessages<ChatUIMessage>(history, {
        convertDataPart(part) {
          if (part.type === 'data-client')
            return {
              type: 'text',
              text: `[Client Context: ${JSON.stringify(part.data)}]`,
            };
        },
      })),
    ],
    toolChoice: 'auto',
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

const searchTool = tool({
  description: 'Search the docs content. Returns pages with title, url, a content snippet and a relevance score.',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  async execute({ query, limit }) {
    const search = await searchServer;
    const raw = await search.searchAsync(query, { limit, merge: true, enrich: true });

    // normalize FlexSearch enriched results into a flat shape
    // (same shape as the production backend's search_docs tool)
    type RawHit = { document?: Partial<CustomDocument>; doc?: Partial<CustomDocument> } & Partial<CustomDocument>;
    const results = Array.isArray(raw) ? (raw as RawHit[]) : ((raw as { results?: RawHit[] }).results ?? []);

    return results.map((hit) => {
      const doc: Partial<CustomDocument> = hit.document ?? hit.doc ?? hit;
      return {
        title: doc.title ?? 'Untitled',
        url: doc.url ?? '',
        content: (doc.content ?? '').slice(0, 300),
        score: typeof hit.score === 'number' ? hit.score : 0,
      };
    });
  },
}) satisfies SearchTool;