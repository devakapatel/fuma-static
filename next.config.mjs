import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const isDev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const config = {
  // `output: 'export'` makes `next dev` throw on any URL that isn't in
  // generateStaticParams() (e.g. an old /docs bookmark). The deployed site
  // still needs a static export, so only enable it for production builds.
  ...(isDev ? {} : { output: 'export' }),
  reactStrictMode: true,
  // static export cannot run the image optimization API;
  // serve images as-is (same as t9-fuma)
  images: { unoptimized: true },
};

export default withMDX(config);
