import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'T9';
export const appEmoji = '🏁';
export const appTitle = `${appEmoji} ${appName}`;
// docs live at root-level slugs: /test, /hello-world, ...
// docsRoute is empty; the docs "index" page maps to /index
export const docsRoute = '';
export const docsImageRoute = '/og';
export const docsContentRoute = '/llms.mdx';

export const gitConfig = {
  user: 'devakapatel',
  repo: 'fuma-static',
  branch: 'main',
};

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
