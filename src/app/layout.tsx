import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
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
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}