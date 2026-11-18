import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import { ArrowUpRight, Megaphone } from 'lucide-react';
import { Banner } from 'fumadocs-ui/components/banner';
import { Provider } from '@/components/provider';
import { DonateBanner } from '@/components/site-banner';
import { telegramUrl } from '@/lib/links';
import { appName, appEmoji } from '@/lib/shared';
import 'katex/dist/katex.css';
import './global.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

// SVG data-URL favicon: the browser renders the emoji with the visitor's
// own system emoji font, so it always matches the emoji in the tab title
// and stays crisp at any size (same approach as t9.pages.dev).
const emojiFavicon = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${appEmoji}</text></svg>`;

export const metadata: Metadata = {
  title: {
    // per-page titles resolve to e.g. "Hello World | T9" at build time
    template: `%s | ${appName}`,
    // pages without their own title (e.g. home)
    default: appName,
  },
  icons: {
    icon: [
      {
        url: emojiFavicon,
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexSans.className}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen font-sans">
        <DonateBanner />
        {/* Second bar scrolls away instead of stacking stickily under the
            donation banner, so there is only one sticky offset to manage. */}
        <Banner
          variant="normal"
          changeLayout={false}
          className="static z-auto border-t border-fd-border/60 bg-fd-secondary/50"
        >
          <span className="flex items-center gap-2 text-fd-muted-foreground">
            <Megaphone className="size-4 shrink-0 text-amber-500" />
            <span>
              <span className="sm:hidden">Advertise?</span>
              <span className="hidden sm:inline">
                Want to advertise with us?
              </span>
            </span>
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold whitespace-nowrap text-amber-800 transition-colors hover:border-amber-500/60 hover:bg-amber-500/20 dark:text-amber-300"
            >
              <span className="sm:hidden">Contact</span>
              <span className="hidden sm:inline">Contact here</span>
              <ArrowUpRight className="size-3" />
            </a>
          </span>
        </Banner>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
