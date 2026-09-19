'use client';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type SyntheticEvent,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, Check, Loader2, MessageCircleIcon, RefreshCw, SearchIcon, Send, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { buttonVariants } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from 'fumadocs-ui/components/ui/popover';
import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import { DefaultChatTransport, type Tool, type UIMessage, type UIToolInvocation } from 'ai';
import { Markdown } from '../markdown';

/**
 * Concatenate the assistant's text parts for rendering.
 * Text parts are separated by tool calls / reasoning parts — join them with
 * a paragraph break so two separate parts don't get glued together into
 * broken markdown (e.g. `...sentence**Heading`).
 */
function getMarkdownText(message: ChatUIMessage): string {
  const texts: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === 'text' && part.text.length > 0) texts.push(part.text);
  }
  return texts.join('\n\n');
}

export type ChatUIMessage = UIMessage<
  never,
  {
    client: {
      location: string;
    };
  }
>;

export type SearchTool = Tool<{ query: string; limit: number }>;

// ---------- model selection ----------

export interface ChatModel {
  id: string;
  name: string;
}

const StorageKeyModel = '__ai_chat_model';
const FALLBACK_MODEL = 'deepseek/deepseek-v4-flash-0731:free';

function useChatModels() {
  const [models, setModels] = useState<ChatModel[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const api = process.env.NEXT_PUBLIC_CHAT_API_URL ?? '/api/chat';
    const modelsUrl = new URL(api.replace(/\/?chat$/, ''), window.location.origin);
    // same origin as the chat API; local dev falls back to /api/models
    const url =
      api.startsWith('http')
        ? `${new URL(api).origin}/api/models`
        : '/api/models';

    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { models?: ChatModel[] }) => {
        if (!cancelled) setModels(data.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { models, error };
}

function useSelectedModel(): [string, (id: string) => void] {
  const [model, setModel] = useState(() => localStorage.getItem(StorageKeyModel) ?? FALLBACK_MODEL);

  const select = (id: string) => {
    setModel(id);
    localStorage.setItem(StorageKeyModel, id);
  };

  return [model, select];
}

function shortModelName(model: ChatModel): string {
  // "inclusionAI: Ling 3.0 Flash VL (free)" -> "Ling 3.0 Flash VL"
  const name = model.name.includes(':') ? model.name.split(':').slice(1).join(':').trim() : model.name;
  return name.replace(/\s*\(free\)\s*$/i, '');
}

function ModelPicker({ className }: { className?: string }) {
  const { models, error } = useChatModels();
  const [model, select] = useSelectedModel();
  const [open, setOpen] = useState(false);

  const current = models.find((m) => m.id === model);

  // keep persisted selection valid; fall back if the model disappeared
  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === model)) {
      select(models[0].id);
    }
  }, [models, model]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Choose a model"
        className={(s) =>
          cn(
            buttonVariants({
              variant: 'outline',
              size: 'sm',
              className:
                'gap-1.5 text-xs border-fd-primary/40 bg-fd-primary/10 text-fd-primary hover:bg-fd-primary/20 hover:text-fd-primary',
            }),
            s.open && 'bg-fd-primary/25 border-fd-primary/60',
            className,
          )
        }
      >
        <span className="max-w-[140px] truncate">
          {current ? shortModelName(current) : (model.split('/').pop()?.replace(':free', '') ?? 'Model')}
        </span>
        <ChevronDown className="size-3.5 text-fd-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-0.5 p-1">
        <p className="p-2 text-xs font-medium text-fd-muted-foreground">
          {error || models.length === 0 ? 'Failed to load models' : 'Choose a model'}
        </p>
        {models.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.id}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1.5 text-start text-sm rounded-lg transition-colors',
              item.id === model
                ? 'bg-fd-primary/10 text-fd-primary'
                : 'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground',
            )}
            onClick={() => {
              select(item.id);
              setOpen(false);
            }}
          >
            <span className="flex-1 truncate">{shortModelName(item)}</span>
            {item.id === model && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const Context = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  chat: UseChatHelpers<ChatUIMessage>;
} | null>(null);

export function AISearchPanelHeader({ className, ...props }: ComponentProps<'div'>) {
  const { setOpen } = useAISearchContext();

  return (
    <div
      className={cn(
        'sticky top-0 flex items-start gap-2 border rounded-xl bg-fd-secondary text-fd-secondary-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="px-3 py-2 flex-1">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium">AI Chat</p>
          <ModelPicker />
        </div>
        <p className="text-xs text-fd-muted-foreground">
          AI can be inaccurate, please verify the answers.
        </p>
      </div>

      <button
        aria-label="Close"
        tabIndex={-1}
        className={cn(
          buttonVariants({
            size: 'icon-sm',
            variant: 'ghost',
            className: 'text-fd-muted-foreground rounded-full',
          }),
        )}
        onClick={() => setOpen(false)}
      >
        <X />
      </button>
    </div>
  );
}

export function AISearchInputActions() {
  const { messages, status, setMessages, regenerate } = useChatContext();
  const isLoading = status === 'streaming';

  if (messages.length === 0) return null;

  return (
    <>
      {!isLoading && messages.at(-1)?.role === 'assistant' && (
        <button
          type="button"
          className={cn(
            buttonVariants({
              variant: 'secondary',
              size: 'sm',
              className: 'rounded-full gap-1.5',
            }),
          )}
          onClick={() => regenerate()}
        >
          <RefreshCw className="size-4" />
          Retry
        </button>
      )}
      <button
        type="button"
        className={cn(
          buttonVariants({
            variant: 'secondary',
            size: 'sm',
            className: 'rounded-full',
          }),
        )}
        onClick={() => setMessages([])}
      >
        Clear Chat
      </button>
    </>
  );
}

const StorageKeyInput = '__ai_search_input';
export function AISearchInput(props: ComponentProps<'form'>) {
  const { status, sendMessage, stop } = useChatContext();
  const [input, setInput] = useState(() => localStorage.getItem(StorageKeyInput) ?? '');
  const isLoading = status === 'streaming' || status === 'submitted';
  const onStart = (e?: SyntheticEvent) => {
    e?.preventDefault();
    const message = input.trim();
    if (message.length === 0) return;

    void sendMessage({
      role: 'user',
      parts: [
        {
          type: 'data-client',
          data: {
            location: location.href,
          },
        },
        {
          type: 'text',
          text: message,
        },
      ],
    });
    setInput('');
    localStorage.removeItem(StorageKeyInput);
  };

  useEffect(() => {
    if (isLoading) document.getElementById('nd-ai-input')?.focus();
  }, [isLoading]);

  return (
    <form {...props} className={cn('flex items-start pe-2', props.className)} onSubmit={onStart}>
      <Input
        value={input}
        placeholder={isLoading ? 'AI is answering...' : 'Ask a question'}
        autoFocus
        className="p-3"
        disabled={status === 'streaming' || status === 'submitted'}
        onChange={(e) => {
          setInput(e.target.value);
          localStorage.setItem(StorageKeyInput, e.target.value);
        }}
        onKeyDown={(event) => {
          // keyCode 229: Safari fires `compositionend` before this keydown, `isComposing` is already false
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (!event.shiftKey && event.key === 'Enter') {
            onStart(event);
          }
        }}
      />
      {isLoading ? (
        <button
          key="bn"
          type="button"
          className={cn(
            buttonVariants({
              variant: 'secondary',
              className: 'transition-all rounded-full mt-2 gap-2',
            }),
          )}
          onClick={stop}
        >
          <Loader2 className="size-4 animate-spin text-fd-muted-foreground" />
          Abort Answer
        </button>
      ) : (
        <button
          key="bn"
          type="submit"
          className={cn(
            buttonVariants({
              variant: 'default',
              className: 'transition-all rounded-full mt-2',
            }),
          )}
          disabled={input.length === 0}
        >
          <Send className="size-4" />
        </button>
      )}
    </form>
  );
}

function List(props: Omit<ComponentProps<'div'>, 'dir'>) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    function callback() {
      const container = containerRef.current;
      if (!container) return;

      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'instant',
      });
    }

    const observer = new ResizeObserver(callback);
    callback();

    const element = containerRef.current?.firstElementChild;

    if (element) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      {...props}
      className={cn('fd-scroll-container overflow-y-auto min-w-0 flex flex-col', props.className)}
    >
      {props.children}
    </div>
  );
}

function Input(props: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLDivElement>(null);
  const shared = cn('col-start-1 row-start-1', props.className);

  return (
    <div className="grid flex-1">
      <textarea
        id="nd-ai-input"
        {...props}
        className={cn(
          'resize-none bg-transparent placeholder:text-fd-muted-foreground focus-visible:outline-none',
          shared,
        )}
      />
      <div ref={ref} className={cn(shared, 'break-all invisible')}>
        {`${props.value?.toString() ?? ''}\n`}
      </div>
    </div>
  );
}

const roleName: Record<string, string> = {
  user: 'You',
  assistant: 'T9 AI',
};

function Message({ message, ...props }: { message: ChatUIMessage } & ComponentProps<'div'>) {
  const isStreaming = message.role === 'assistant' && !isMessageDone(message);
  const markdown = getMarkdownText(message);
  const searchCalls: UIToolInvocation<SearchTool>[] = [];

  for (const part of message.parts ?? []) {
    if (part.type.startsWith('tool-')) {
      const toolName = part.type.slice('tool-'.length);
      const p = part as UIToolInvocation<Tool>;

      if (toolName !== 'search' || !p.toolCallId) continue;
      searchCalls.push(p);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} {...props}>
      <p
        className={cn(
          'mb-1 text-sm font-medium text-fd-muted-foreground',
          message.role === 'assistant' && 'text-fd-primary',
        )}
      >
        {roleName[message.role] ?? 'unknown'}
      </p>
      <div className="prose text-sm ai-chat-prose">
        <Markdown text={markdown} stream={isStreaming} />
      </div>

      {searchCalls.map((call) => {
        return (
          <div
            key={call.toolCallId}
            className="flex flex-row gap-2 items-center mt-3 rounded-lg border bg-fd-secondary text-fd-muted-foreground text-xs p-2"
          >
            <SearchIcon className="size-4" />
            {call.state === 'output-error' || call.state === 'output-denied' ? (
              <p className="text-fd-error">{call.errorText ?? 'Failed to search'}</p>
            ) : (
              <p>{!call.output ? 'Searching…' : `${call.output.length} search results`}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AISearch({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const chat = useChat<ChatUIMessage>({
    id: 'search',
    transport: new DefaultChatTransport({
      api: process.env.NEXT_PUBLIC_CHAT_API_URL ?? '/api/chat',
      prepareSendMessagesRequest({ messages }) {
        return {
          body: {
            messages,
            // read per-request so dropdown changes apply immediately
            model: localStorage.getItem(StorageKeyModel) ?? undefined,
          },
        };
      },
    }),
  });

  return (
    <Context value={useMemo(() => ({ chat, open, setOpen }), [chat, open])}>{children}</Context>
  );
}

export function AISearchTrigger({
  position = 'default',
  className,
  ...props
}: ComponentProps<'button'> & { position?: 'default' | 'float' }) {
  const { open, setOpen } = useAISearchContext();

  return (
    <button
      data-state={open ? 'open' : 'closed'}
      className={cn(
        position === 'float' && [
          'fixed bottom-4 gap-3 w-24 inset-e-[calc(--spacing(4)+var(--removed-body-scroll-bar-size,0px))] shadow-lg z-20 transition-[translate,opacity]',
          open && 'translate-y-10 opacity-0',
        ],
        className,
      )}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {props.children}
    </button>
  );
}

export function AISearchPanel() {
  const { open, setOpen } = useAISearchContext();
  const [actualOpen, setActualOpen] = useState(open);
  useHotKey();

  if (open && !actualOpen) setActualOpen(open);

  return (
    <>
      <style>
        {`
        @keyframes ask-ai-open {
          from {
            translate: 100% 0;
          }
          to {
            translate: 0 0;
          }
        }
        @keyframes ask-ai-close {
          from {
            width: var(--ai-chat-width);
          }
          to {
            width: 0px;
          }
        }`}
      </style>
      {actualOpen && (
        <div
          className={cn(
            'fixed inset-0 z-30 backdrop-blur-xs bg-fd-overlay lg:hidden',
            open ? 'animate-fd-fade-in' : 'animate-fd-fade-out',
          )}
          onClick={() => setOpen(false)}
          onAnimationEnd={() => {
            if (!open) flushSync(() => setActualOpen(false));
          }}
        />
      )}
      {actualOpen && (
        <div
          className={cn(
            'overflow-hidden z-30 bg-fd-card text-fd-card-foreground [--ai-chat-width:400px] 2xl:[--ai-chat-width:460px]',
            'max-lg:fixed max-lg:inset-x-2 max-lg:inset-y-4 max-lg:border max-lg:rounded-2xl max-lg:shadow-xl',
            'lg:sticky lg:top-0 lg:h-dvh lg:border-s lg:ms-auto lg:in-[#nd-docs-layout]:[grid-area:toc] lg:in-[#nd-notebook-layout]:row-span-full lg:in-[#nd-notebook-layout]:col-start-5',
            open
              ? 'animate-fd-dialog-in lg:animate-[ask-ai-open_200ms]'
              : 'animate-fd-dialog-out lg:animate-[ask-ai-close_200ms]',
          )}
          onAnimationEnd={() => {
            if (!open) flushSync(() => setActualOpen(false));
          }}
        >
          <div className="flex flex-col size-full p-2 lg:p-3 lg:w-(--ai-chat-width)">
            <AISearchPanelHeader />
            <AISearchPanelList className="flex-1" />
            <div className="rounded-xl border bg-fd-secondary text-fd-secondary-foreground shadow-sm has-focus-visible:shadow-md">
              <AISearchInput />
              <div className="flex items-center gap-1.5 p-1 empty:hidden">
                <AISearchInputActions />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AISearchPanelList({ className, style, ...props }: ComponentProps<'div'>) {
  const chat = useChatContext();
  const messages = chat.messages.filter((msg) => msg.role !== 'system');

  return (
    <List
      className={cn('py-4 overscroll-contain', className)}
      style={{
        maskImage:
          'linear-gradient(to bottom, transparent, white 1rem, white calc(100% - 1rem), transparent 100%)',
        ...style,
      }}
      {...props}
    >
      {messages.length === 0 ? (
        <div className="text-sm text-fd-muted-foreground/80 size-full flex flex-col items-center justify-center text-center gap-2">
          <MessageCircleIcon fill="currentColor" stroke="none" />
          <p onClick={(e) => e.stopPropagation()}>Start a new chat below.</p>
        </div>
      ) : (
        <div className="flex flex-col px-3 gap-4">
          {chat.error && (
            <div className="p-2 bg-fd-secondary text-fd-secondary-foreground border rounded-lg">
              <p className="text-xs text-fd-muted-foreground mb-1">
                Request Failed: {chat.error.name}
              </p>
              <p className="text-sm">{chat.error.message}</p>
            </div>
          )}
          {messages.map((item) => (
            <Message key={item.id} message={item} />
          ))}
        </div>
      )}
    </List>
  );
}

export function useHotKey() {
  const { open, setOpen } = useAISearchContext();

  const onKeyPress = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      e.preventDefault();
    }

    if (e.key === '/' && (e.metaKey || e.ctrlKey) && !open) {
      setOpen(true);
      e.preventDefault();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyPress);
    return () => window.removeEventListener('keydown', onKeyPress);
  }, []);
}

export function useAISearchContext() {
  return use(Context)!;
}

function useChatContext() {
  return use(Context)!.chat;
}

/**
 * A message is "done" when every non-reasoning part is in a terminal state.
 * While parts are still streaming in, markdown needs stream normalization.
 */
function isMessageDone(message: ChatUIMessage): boolean {
  const parts = message.parts ?? [];
  if (parts.length === 0) return true;
  return parts.every(
    (part) =>
      part.type === 'text' ||
      (part.type.startsWith('tool-') &&
        ['output-available', 'output-error', 'output-denied'].includes(
          (part as UIToolInvocation<Tool>).state,
        )),
  );
}
