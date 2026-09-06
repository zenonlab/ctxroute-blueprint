import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const workspaceRoot = resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  output: 'export',
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ['@tobirink/ui'],
  images: { unoptimized: true },
  turbopack: { root: workspaceRoot },
};

export default nextConfig;
