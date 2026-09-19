import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import {
  Children,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  Suspense,
  use,
  useDeferredValue,
} from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { visit } from 'unist-util-visit';
import type { ElementContent, Root, RootContent } from 'hast';

export interface Processor {
  process: (content: string) => Promise<ReactNode>;
}

export function rehypeWrapWords() {
  return (tree: Root) => {
    visit(tree, ['text', 'element'], (node, index, parent) => {
      if (node.type === 'element' && node.tagName === 'pre') return 'skip';
      if (node.type !== 'text' || !parent || index === undefined) return;

      const words = node.value.split(/(?=\s)/);

      // Create new span nodes for each word and whitespace
      const newNodes: ElementContent[] = words.flatMap((word) => {
        if (word.length === 0) return [];

        return {
          type: 'element',
          tagName: 'span',
          properties: {
            class: 'animate-fd-fade-in',
          },
          children: [{ type: 'text', value: word }],
        };
      });

      Object.assign(node, {
        type: 'element',
        tagName: 'span',
        properties: {},
        children: newNodes,
      } satisfies RootContent);
      return 'skip';
    });
  };
}

function createProcessor(): Processor {
  const processor = remark().use(remarkGfm).use(remarkRehype).use(rehypeWrapWords);

  return {
    async process(content) {
      const nodes = processor.parse({ value: content });
      const hast = await processor.run(nodes);

      return toJsxRuntime(hast, {
        development: false,
        jsx,
        jsxs,
        Fragment,
        components: {
          ...defaultMdxComponents,
          pre: Pre,
          img: undefined, // use JSX
        },
      });
    },
  };
}

function Pre(props: ComponentProps<'pre'>) {
  const code = Children.only(props.children) as ReactElement;
  const codeProps = code.props as ComponentProps<'code'>;
  const content = codeProps.children;
  if (typeof content !== 'string') return null;

  let lang =
    codeProps.className
      ?.split(' ')
      .find((v) => v.startsWith('language-'))
      ?.slice('language-'.length) ?? 'text';

  if (lang === 'mdx') lang = 'md';

  return <DynamicCodeBlock lang={lang} code={content.trimEnd()} />;
}

const processor = createProcessor();

/**
 * Make in-progress (streaming) markdown render cleanly:
 * - hides reasoning blocks like <think>...</think>
 * - closes unclosed code fences so partial code doesn't leak raw backticks
 * - balances unclosed inline marks (bold, strikethrough, inline code)
 *
 * Heuristic and only affects *incomplete* input; once the stream ends with
 * well-formed markdown, the output is unchanged (idempotent on closed input).
 */
export function normalizeStreamMarkdown(text: string): string {
  let out = text
    // complete reasoning blocks, and drop an unclosed one while still streaming
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '');

  const lines = out.split('\n');
  const fenceCount = lines.filter((line) => /^[ \t]*```/.test(line)).length;
  const inUnclosedFence = fenceCount % 2 === 1;

  // close an unclosed fenced code block
  if (inUnclosedFence) out += '\n```';

  // balance inline marks, ignoring lines inside code fences
  if (!inUnclosedFence) {
    const withoutFences = lines
      .filter((line) => !/^[ \t]*```/.test(line))
      .join('\n');

    const count = (marker: string) => withoutFences.split(marker).length - 1;

    if (count('**') % 2 === 1) out += '**';
    if (count('~~') % 2 === 1) out += '~~';
    if (count('`') % 2 === 1) out += '`';
  }

  return out;
}

export function Markdown({ text, stream = false }: { text: string; stream?: boolean }) {
  const normalized = stream ? normalizeStreamMarkdown(text) : text;
  const deferredText = useDeferredValue(normalized);

  return (
    <Suspense fallback={<p className="invisible">{text}</p>}>
      <Renderer text={deferredText} />
    </Suspense>
  );
}

const cache = new Map<string, Promise<ReactNode>>();

function Renderer({ text }: { text: string }) {
  const result = cache.get(text) ?? processor.process(text);
  cache.set(text, result);

  return use(result);
}
