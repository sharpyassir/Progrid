import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Connection } from '@temporalio/client';
import Redis from 'ioredis';

/**
 * Runs once before the suite: recreates the test database, applies every migration, runs the
 * seed plus a larger address block for the suite, empties the Redis database the suite uses,
 * and checks that Temporal answers. Everything the tests need is created here or by the tests.
 */
export default async function setup() {
  const dbUrl = process.env.IT_DATABASE_URL ?? 'postgresql://pgcloud:pgcloud@localhost:5432/pgcloud_test';
  const redisUrl = process.env.IT_REDIS_URL ?? 'redis://localhost:6379/5';
  const temporal = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const root = resolve(__dirname, '../..');

  const url = new URL(dbUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes('test')) throw new Error(`refusing to recreate database "${name}": the name must contain "test"`);
  const admin = new URL(dbUrl);
  admin.pathname = '/postgres';
  const pg = new PrismaClient({ datasourceUrl: admin.toString() });
  await pg.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await pg.$executeRawUnsafe(`CREATE DATABASE ${name}`);
  await pg.$disconnect();

  const env = { ...process.env, DATABASE_URL: dbUrl };
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, env, stdio: 'pipe' });
  execFileSync('npx', ['ts-node', '--transpile-only', 'prisma/seed.ts'], { cwd: root, env, stdio: 'pipe' });

  // Room for many clusters: a /24 of public addresses and a second host.
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  const block = await db.ipBlock.create({ data: { regionId: 'sa1', cidr: '198.51.100.0/24', gateway: '198.51.100.1' } });
  await db.publicIp.createMany({ data: Array.from({ length: 252 }, (_, i) => ({ regionId: 'sa1', blockId: block.id, address: `198.51.100.${i + 2}` })) });
  const host = await db.host.create({ data: { name: 'fake2', regionId: 'sa1', driver: 'fake', driverRef: '{"node":"fake2"}', totalVcpu: 256, totalMemoryMb: 1_048_576, totalDiskGb: 20_000, overcommitCpu: 4 } });
  await db.host.update({ where: { id: host.id }, data: { driverRef: JSON.stringify({ node: 'fake2', hostId: host.id }) } });
  await db.host.updateMany({ data: { status: 'active', lastHeartbeatAt: new Date() } });
  await db.$disconnect();

  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();

  try {
    const conn = await Connection.connect({ address: temporal, connectTimeout: 5000 });
    await conn.close();
  } catch (err) {
    throw new Error(`Temporal is not reachable at ${temporal} (${(err as Error).message}). Start one with: temporal server start-dev --headless`);
  }
}
