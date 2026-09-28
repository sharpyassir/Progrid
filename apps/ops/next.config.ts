import path from 'node:path';
import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Trace from the workspace root so the standalone bundle lands at .next/standalone/apps/ops/server.js
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  // The Content Security Policy carries a fresh nonce per request, so middleware.ts sets it; every
  // other security header is static and set here for every path.
  async headers() {
    return [{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }];
  },
};

export default config;
