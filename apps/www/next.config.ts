import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Trace from the workspace root so the standalone bundle lands at .next/standalone/apps/<app>/server.js
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Pages render per request (the Host picks progrid.co or progrid.sa), so the markdown they read must ship with the server.
  outputFileTracingIncludes: { '/**': ['./content/**/*'] },
};

export default config;
