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
import { docsRoute } from '@/lib/shared';
import { Document, type DocumentData } from 'flexsearch';
import { ChatUIMessage, SearchTool } from '../../../components/ai/search';

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

/** System prompt, you can update it to provide more specific information */
const systemPrompt = [
  'You are an AI assistant for a documentation site.',
  'Use the `search` tool to retrieve relevant docs context before answering when needed.',
  'The `search` tool returns raw JSON results from documentation. Use those results to ground your answer and cite sources as markdown links using the document `url` field when available.',
  'If you cannot find the answer in search results, say you do not know and suggest a better search query.',
].join('\n');

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

  if (!pathname.startsWith(`${docsRoute}/`) && pathname !== docsRoute) return null;

  // strip the docs base path, e.g. `/docs/foo/bar` -> `['foo', 'bar']`
  const slugs = pathname
    .slice(docsRoute.length)
    .split('/')
    .filter((slug) => slug.length > 0 && slug !== 'index');

  const page = source.getPage(slugs);
  if (!page || !('getText' in page.data)) return null;

  const content = await page.data.getText('processed');
  if (!content) return null;

  return `--- Current Page: ${page.data.title} (${page.url}) ---\n${content}\n--- End of Current Page ---`;
}

export async function POST(req: Request, ctx: RouteContext<"/api/chat">) {
  const reqJson = await req.json();

  // the current page URL sent by the client as a `data-client` part
  const clientLocation = reqJson.messages?.at(-1)?.parts?.find(
    (part: { type?: string }) => part.type === 'data-client',
  )?.data?.location;

  const currentPageContext = await getCurrentPageContext(clientLocation);

  const result = streamText({
    model: openrouter.chat(process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet'),
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
      ...(await convertToModelMessages<ChatUIMessage>(reqJson.messages ?? [], {
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
  description: 'Search the docs content and return raw JSON results.',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().min(1).max(100).default(10),
  }),
  async execute({ query, limit }) {
    const search = await searchServer;
    return await search.searchAsync(query, { limit, merge: true, enrich: true });
  },
}) satisfies SearchTool;