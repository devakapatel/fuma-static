'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Heart, X } from 'lucide-react';
import { Banner } from 'fumadocs-ui/components/banner';

/**
 * Donation banner shown on every page load and closeable for the current
 * visit. It deliberately has no `id`, because fumadocs' `Banner` uses the id
 * to remember a dismissal in `localStorage`; without one the visitor sees it
 * again the next time they open the site.
 */
export function DonateBanner() {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  return (
    <Banner
      variant="normal"
      className="border-b border-emerald-500/25 bg-emerald-50 pr-10 dark:bg-emerald-950"
    >
      <span className="flex items-center gap-2 text-fd-muted-foreground">
        <Heart className="size-4 shrink-0 text-emerald-500" />
        <span>
          <span className="sm:hidden">Support T9</span>
          <span className="hidden sm:inline">Donations keep T9 free.</span>
        </span>
        <Link
          href="/account?donate=1"
          className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-sm transition-colors hover:bg-emerald-600"
        >
          <span className="sm:hidden">Donate</span>
          <span className="hidden sm:inline">Donate us</span>
          <ArrowRight className="size-3" />
        </Link>
      </span>
      <button
        type="button"
        aria-label="Close banner"
        onClick={() => setOpen(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
      >
        <X className="size-4" />
      </button>
    </Banner>
  );
}
