import { defineConfig, type Plugin } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Integration suite: boots the API and the Temporal worker in process against a real
 * Postgres database, Redis and a Temporal server. Run with `pnpm test:integration`.
 * See the "Integration tests" section of apps/api/README.md.
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Nest resolves constructor arguments from decorator metadata, which esbuild does not emit.
 * Compile the app's own TypeScript with the TypeScript compiler instead.
 */
function decoratorMetadata(): Plugin {
  return {
    name: 'pgcloud-decorator-metadata',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || id.includes('/node_modules/')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          sourceMap: true,
          inlineSources: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText ? JSON.parse(out.sourceMapText) : null };
    },
  };
}

const runId = `${Date.now().toString(36)}-${process.pid}`;

export default defineConfig({
  root,
  esbuild: false,
  plugins: [decoratorMetadata()],
  test: {
    include: ['test/integration/**/*.it.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // One process for the whole suite: the API and the worker boot once and every file shares them.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    isolate: false,
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
    server: { deps: { inline: [/apps\/api\/src/] } },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.IT_DATABASE_URL ?? 'postgresql://pgcloud:pgcloud@localhost:5432/pgcloud_test',
      REDIS_URL: process.env.IT_REDIS_URL ?? 'redis://localhost:6379/5',
      NATS_URL: process.env.NATS_URL ?? 'nats://localhost:4222',
      TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      // A queue of its own per run, so workflows left over from an earlier run never land here.
      TEMPORAL_TASK_QUEUE: `pgcloud-it-${runId}`,
      HYPERVISOR_DRIVER: 'fake',
      PAYMENT_PROVIDER: 'fake',
      DNS_PROVIDER: 'fake',
      OBJECT_STORAGE_PROVIDER: 'fake',
      MAIL_PROVIDER: 'log',
      REQUIRE_PREPAID_BEFORE_POSTPAID: 'true',
      REQUIRE_TOTP_FOR_STAFF: 'true',
      FREE_ALLOWANCE_MINOR: '0',
      JWT_SECRET: 'integration-test-secret-0123456789',
      PUBLIC_API_URL: 'http://127.0.0.1:4999',
      FX_PROVIDER_URL: 'http://127.0.0.1:9/unused',
    },
  },
});
