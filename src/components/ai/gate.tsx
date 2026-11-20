'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ArrowUpRight, LockKeyhole, MessageCircleIcon, X } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-context';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { AISearch, AISearchPanel, AISearchTrigger } from './search';

const floatButton =
  'fixed bottom-4 gap-3 w-24 inset-e-[calc(--spacing(4)+var(--removed-body-scroll-bar-size,0px))] shadow-lg z-20 transition-[translate,opacity]';

const telegramUrl = 'https://t.me/t9_pages_dev';

export function AIAccessGate() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [lockedOpen, setLockedOpen] = useState(false);

  if (loading) return null;

  // The account page has its own forms; don't float a second entry point over it.
  if (pathname === '/account') return null;

  if (!user) {
    return (
      <Link
        href={`/account?next=${encodeURIComponent(pathname)}`}
        className={cn(
          buttonVariants({
            variant: 'secondary',
            className: 'text-fd-muted-foreground rounded-2xl',
          }),
          floatButton,
        )}
      >
        <MessageCircleIcon className="size-4.5" />
        Ask AI
      </Link>
    );
  }

  if (!user.paid) {
    return (
      <>
        <button
          type="button"
          onClick={() => setLockedOpen(true)}
          className={cn(
            buttonVariants({
              variant: 'secondary',
              className: 'text-fd-muted-foreground rounded-2xl',
            }),
            floatButton,
          )}
        >
          <LockKeyhole className="size-4.5" />
          AI access
        </button>

        {lockedOpen && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-fd-overlay p-4"
            onClick={() => setLockedOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-paywall-title"
              className="w-full max-w-sm rounded-2xl border bg-fd-card p-6 text-fd-card-foreground shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="ai-paywall-title" className="text-lg font-semibold">
                    AI is for paid members
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                    Your account <span className="font-medium">{user.email}</span> is signed
                    in, but AI access is not active yet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLockedOpen(false)}
                  aria-label="Close"
                  className={cn(
                    buttonVariants({
                      variant: 'ghost',
                      size: 'icon-sm',
                      className: 'rounded-full',
                    }),
                  )}
                >
                  <X />
                </button>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Link
                  href={`/account?next=${encodeURIComponent(pathname)}`}
                  className={cn(
                    buttonVariants({
                      variant: 'primary',
                      className: 'justify-between rounded-full',
                    }),
                  )}
                  onClick={() => setLockedOpen(false)}
                >
                  Get AI access
                  <ArrowRight className="size-4" />
                </Link>
                <p className="text-center text-xs text-fd-muted-foreground">
                  Pay with UPI or a card on your account page. Access activates
                  automatically.
                </p>
                <a
                  href={telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1 text-xs font-medium text-fd-muted-foreground hover:underline"
                >
                  Need help? Contact the admin
                  <ArrowUpRight className="size-3" />
                </a>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <AISearch>
      <AISearchPanel />
      <AISearchTrigger
        position="float"
        className={cn(
          buttonVariants({
            variant: 'secondary',
            className: 'text-fd-muted-foreground rounded-2xl',
          }),
        )}
      >
        <MessageCircleIcon className="size-4.5" />
        Ask AI
      </AISearchTrigger>
    </AISearch>
  );
}
