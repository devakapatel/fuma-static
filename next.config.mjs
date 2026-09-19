import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  // static export cannot run the image optimization API;
  // serve images as-is (same as t9-fuma)
  images: { unoptimized: true },
};

export default withMDX(config);
