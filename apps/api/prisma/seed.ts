/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { MARKETPLACE_APPS } from './seed-apps';
import { HOLIDAYS, MANAGED_HOURLY_RATE_MINOR, MANAGED_PLANS } from './seed-managed';

const prisma = new PrismaClient();

/** Launch price book is valid from the start of the launch year so back-dated usage rates. */
const PRICE_VALID_FROM = new Date(Date.UTC(2026, 0, 1));

/**
 * Progrid price book, in halalas (SAR minor units), excluding 15% VAT. Dollar prices are
 * derived at the pegged rate and never stored. Plans mirror the launch price list.
 */
const SIZES = [
  { id: 's-1vcpu-2gb', name: 'Starter', vcpu: 1, memoryMb: 2048, diskGb: 40, transferTb: 2, sar: 2900 },
  { id: 's-2vcpu-4gb', name: 'Standard', vcpu: 2, memoryMb: 4096, diskGb: 80, transferTb: 4, sar: 6500 },
  { id: 's-4vcpu-8gb', name: 'Pro', vcpu: 4, memoryMb: 8192, diskGb: 160, transferTb: 6, sar: 12500 },
  { id: 's-8vcpu-16gb', name: 'Business', vcpu: 8, memoryMb: 16384, diskGb: 320, transferTb: 8, sar: 23900 },
];

/** Managed VPS: same hardware plus setup, OS updates, hardening, backups and support. Total monthly price in halalas; the add on is total minus the plan. */
const MANAGED = [
  { sizeId: 's-2vcpu-4gb', name: 'Managed Start', sar: 19900 },
  { sizeId: 's-4vcpu-8gb', name: 'Managed Business', sar: 34900 },
  { sizeId: 's-8vcpu-16gb', name: 'Managed Pro', sar: 59900 },
];

const DISTROS = [
  { id: 'ubuntu-24-04', name: 'Ubuntu 24.04 LTS', distribution: 'ubuntu', version: '24.04', driverRef: '{"template":9000}' },
  { id: 'ubuntu-22-04', name: 'Ubuntu 22.04 LTS', distribution: 'ubuntu', version: '22.04', driverRef: '{"template":9001}' },
  { id: 'debian-12', name: 'Debian 12', distribution: 'debian', version: '12', driverRef: '{"template":9002}' },
  { id: 'rocky-9', name: 'Rocky Linux 9', distribution: 'rocky', version: '9', driverRef: '{"template":9003}' },
];

async function main() {
  await prisma.region.upsert({ where: { id: 'sa1' }, update: {}, create: { id: 'sa1', name: 'Saudi Arabia 1', country: 'SA' } });

  const BOOK = 'SAR' as const;
  for (const [i, s] of SIZES.entries()) {
    await prisma.size.upsert({ where: { id: s.id }, update: { name: s.name, vcpu: s.vcpu, memoryMb: s.memoryMb, diskGb: s.diskGb, transferTb: s.transferTb, available: true, sortOrder: i }, create: { id: s.id, name: s.name, vcpu: s.vcpu, memoryMb: s.memoryMb, diskGb: s.diskGb, transferTb: s.transferTb, sortOrder: i } });
    await price('server', s.id, s.sar, 'hour', s.id);
    // Managed database nodes: twice the plan price of the same size, per node.
    await price('database', `db-${s.id}`, s.sar * 2, 'hour', s.id);
  }
  // Plans that are no longer sold stay for existing servers but cannot be chosen.
  await prisma.size.updateMany({ where: { id: { notIn: SIZES.map((s) => s.id) } }, data: { available: false } });
  for (const m of MANAGED) {
    const base = SIZES.find((s) => s.id === m.sizeId)!;
    await price('managed_server', `managed-${m.sizeId}`, m.sar - base.sar, 'hour', m.sizeId);
  }
  for (const [sku, type, sar, unit] of [
    // A public IPv4 address is included with every server.
    ['public_ip', 'public_ip', 0, 'hour'],
    ['snapshot_gb', 'snapshot', 25, 'hour'],
    ['volume_gb', 'volume', 40, 'hour'],
    ['lb_node', 'load_balancer', 4500, 'hour'],
    ['storage_gb', 'object_storage', 8, 'hour'],
    // Outbound transfer above the size's monthly allowance, per GB.
    ['bandwidth_gb', 'bandwidth', 4, 'gb'],
    // Backups: 20% of the server's monthly price. Stored as percent with unit "percent"; RatingService applies it per server hour.
    ['backups_pct', 'backup', 20, 'percent'],
    // Support plans: flat monthly, billed against the team's default project.
    ['support-developer', 'support', 9000, 'month'],
    ['support-standard', 'support', 37500, 'month'],
    ['support-premium', 'support', 187500, 'month'],
    // Kubernetes: a single control plane is included; three control plane nodes carry a flat fee. Workers are billed as servers.
    ['k8s-ha', 'kubernetes', 15000, 'hour'],
    // App Platform: per container instance per month.
    ['app-xs', 'app_instance', 1900, 'hour'],
    ['app-s', 'app_instance', 4500, 'hour'],
    ['app-m', 'app_instance', 9000, 'hour'],
    ['app-l', 'app_instance', 18000, 'hour'],
  ] as const) {
    await price(type, sku, sar, unit);
  }

  /** Creates the current book row for a sku when none exists, and closes an old row whose amount differs. */
  async function price(resourceType: Parameters<typeof prisma.price.create>[0]['data']['resourceType'], sku: string, monthlyMinor: number, unit: string, sizeId?: string) {
    const cur = await prisma.price.findFirst({ where: { resourceType, sku, currency: BOOK, validTo: null } });
    if (cur && cur.monthlyMinor === monthlyMinor) return;
    if (cur) await prisma.price.update({ where: { id: cur.id }, data: { validTo: new Date() } });
    await prisma.price.create({ data: { resourceType, sku, sizeId, currency: BOOK, monthlyMinor, unit, validFrom: cur ? new Date() : PRICE_VALID_FROM } });
  }

  // Starting exchange rate; the hourly job replaces it with the provider's rate.
  if (!(await prisma.fxRate.findFirst({ where: { quote: 'SAR' } }))) {
    await prisma.fxRate.create({ data: { base: 'USD', quote: 'SAR', rate: 3.75, source: 'seed' } });
  }

  for (const d of DISTROS) {
    await prisma.image.upsert({ where: { id: d.id }, update: {}, create: { ...d, kind: 'distribution' } });
  }

  for (const app of MARKETPLACE_APPS) {
    const imageId = `app-${app.slug}`;
    await prisma.image.upsert({
      where: { id: imageId },
      update: {},
      create: { id: imageId, kind: 'marketplace', name: `${app.name} on Ubuntu 24.04`, distribution: 'ubuntu', version: '24.04', driverRef: `{"template":${9100 + MARKETPLACE_APPS.indexOf(app)}}`, minMemoryMb: 1024 },
    });
    await prisma.marketplaceApp.upsert({
      where: { id: app.slug },
      update: { version: app.version, cloudInit: app.cloudInit, variables: app.variables, status: 'published' },
      create: { id: app.slug, imageId, slug: app.slug, name: app.name, category: app.category, summary: app.summary, description: app.description, version: app.version, minSizeId: app.minSizeId, ports: app.ports, variables: app.variables, cloudInit: app.cloudInit, status: 'published', publishedAt: new Date() },
    });
  }

  // Managed cloud plans: created once, then edited in the back office (the seed never overwrites them).
  for (const p of MANAGED_PLANS) {
    await prisma.managedPlan.upsert({ where: { code: p.code }, update: {}, create: { ...p, currency: BOOK, hourlyRateMinor: MANAGED_HOURLY_RATE_MINOR } });
  }
  // Public holidays for business hours SLAs.
  for (const h of HOLIDAYS) {
    const date = new Date(`${h.date}T00:00:00Z`);
    await prisma.holiday.upsert({ where: { country_date: { country: h.country, date } }, update: { name: h.name }, create: { country: h.country, date, name: h.name } });
  }

  // Everything below is demo data for development and CI: a fake host, a documentation IP range and a
  // staff user with a known password. It never runs in production unless SEED_DEMO=true is set on purpose.
  const demo = (process.env.SEED_DEMO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';
  if (!demo) {
    console.log('catalog seed complete (no demo data)');
    return;
  }

  // A fake host + a /28 of public IPs so the fake driver can provision.
  const host = await prisma.host.upsert({
    where: { name: 'fake1' },
    update: {},
    create: { name: 'fake1', regionId: 'sa1', driver: 'fake', driverRef: '{"node":"fake1"}', totalVcpu: 64, totalMemoryMb: 262144, totalDiskGb: 4000, overcommitCpu: 4 },
  });
  await prisma.host.update({ where: { id: host.id }, data: { driverRef: JSON.stringify({ node: 'fake1', hostId: host.id }) } });

  const block = await prisma.ipBlock.upsert({ where: { cidr: '203.0.113.0/28' }, update: {}, create: { regionId: 'sa1', cidr: '203.0.113.0/28', gateway: '203.0.113.1' } });
  for (let i = 2; i < 15; i++) {
    const address = `203.0.113.${i}`;
    await prisma.publicIp.upsert({ where: { address }, update: {}, create: { regionId: 'sa1', blockId: block.id, address } });
  }

  // Dev user + team + token
  const email = 'dev@prgd.local';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Dev User',
        isStaff: true, // so the seeded admin token works locally
        emailVerified: new Date(),
        passwordHash: await argon2.hash('devpassword123'),
        memberships: { create: { role: 'owner', team: { create: { name: 'Dev Team', slug: 'dev', country: 'SA', currency: 'SAR', status: 'active', kycLevel: 1, projects: { create: { name: 'Default', slug: 'default' } } } } } },
      },
    });
    const team = await prisma.team.findUniqueOrThrow({ where: { slug: 'dev' } });
    await prisma.credit.create({ data: { teamId: team.id, kind: 'promo', currency: 'SAR', amountMinor: 37500, remainingMinor: 37500, reason: 'dev seed ($100 at 3.75)' } });
    const raw = 'prgd_' + randomBytes(32).toString('base64url');
    await prisma.apiToken.create({
      data: { teamId: team.id, userId: user.id, name: 'dev', prefix: raw.slice(0, 12), hash: createHash('sha256').update(raw).digest('hex'), scopes: ['servers:read', 'servers:write', 'servers:delete', 'images:read', 'snapshots:read', 'snapshots:write', 'volumes:read', 'volumes:write', 'dns:read', 'dns:write', 'storage:read', 'storage:write', 'databases:read', 'databases:write', 'kubernetes:read', 'kubernetes:write', 'network:read', 'network:write', 'apps:read', 'apps:write', 'billing:read', 'billing:write', 'support:read', 'support:write', 'managed:read', 'managed:write', 'iam:read', 'iam:write'] },
    });
    const admin = 'prgd_' + randomBytes(32).toString('base64url');
    await prisma.apiToken.create({ data: { teamId: team.id, userId: user.id, name: 'staff-admin', prefix: admin.slice(0, 12), hash: createHash('sha256').update(admin).digest('hex'), scopes: ['admin'] } });
    console.log(`\nDev login:   ${email} / devpassword123`);
    console.log(`Dev token:   export PRGD_TOKEN=${raw}`);
    console.log(`Admin token: export PRGD_ADMIN_TOKEN=${admin}\n`);
  }
  console.log('seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
