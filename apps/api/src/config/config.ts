import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WORKER_HEALTH_PORT: z.coerce.number().default(4001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  NATS_URL: z.string().default('nats://localhost:4222'),
  /** Token the production NATS server is started with (--auth). Empty for local dev. */
  NATS_TOKEN: z.string().optional(),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('pgcloud-control-plane'),
  HYPERVISOR_DRIVER: z.enum(['fake', 'proxmox']).default('fake'),
  PROXMOX_CEPH_POOL: z.string().default('vm-disks'),
  /** Proxmox SDN VXLAN zone the per project VNets are created in (PRIVATE_NETWORK_MODE=sdn_vnet). */
  PROXMOX_VXLAN_ZONE: z.string().default('customers'),
  /**
   * Pool the per project private networks are carved from, one network per project and region.
   * One CIDR for every region, or per region: "sa1=10.96.0.0/12,sa2=10.112.0.0/12".
   */
  PRIVATE_NETWORK_POOL: z.string().default('10.96.0.0/12'),
  /** Prefix length of each project network; 24 gives 253 server addresses (.2 to .254). */
  PRIVATE_NETWORK_PREFIX: z.coerce.number().int().min(16).max(28).default(24),
  /**
   * How a project network reaches the hypervisor. shared_bridge puts every net0 on the agent's
   * bridge (dev, and regions without SDN); sdn_vnet gives each project its own VNet in
   * PROXMOX_VXLAN_ZONE. One value for every region, or per region: "sa1=sdn_vnet" (regions not
   * listed use shared_bridge).
   */
  PRIVATE_NETWORK_MODE: z
    .string()
    .default('shared_bridge')
    .refine((v) => v.split(',').every((p) => ['shared_bridge', 'sdn_vnet'].includes(p.split('=').pop()!.trim())), 'PRIVATE_NETWORK_MODE takes shared_bridge or sdn_vnet, optionally per region as region=mode'),
  /** VXLAN tag (VNI) of the first pool network; a network's tag is this plus its index in the pool. */
  PRIVATE_NETWORK_VXLAN_BASE: z.coerce.number().int().min(1).max(16_000_000).default(100_000),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  /** Key for secrets encrypted at rest (TOTP seeds, webhook secrets). Falls back to JWT_SECRET when unset. */
  SECRETS_KEY: z.string().min(16).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400),
  BILLING_HOURS_PER_MONTH: z.coerce.number().default(672),
  DEFAULT_CURRENCY: z.enum(['USD', 'SAR']).default('USD'),
  DEFAULT_REGION: z.string().default('sa1'),
  /** Fallback USD→SAR rate when no FxRate row exists yet (the riyal is pegged at 3.75). */
  FX_USD_SAR: z.coerce.number().positive().default(3.75),
  /** JSON endpoint returning { rates: { SAR: number } } for USD. */
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  /** GitHub App for Git Deploy (optional; without it customers paste a repository URL and token). */
  GITHUB_APP_ID: z.coerce.number().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  /** Card payments. fake = built in test page (development and demos). */
  /** Card payments for both currencies: Moyasar (mada, Visa, Mastercard, Apple Pay) or the built in test page. */
  PAYMENT_PROVIDER: z.enum(['moyasar', 'fake']).default('fake'),
  MOYASAR_SECRET_KEY: z.string().optional(),
  MOYASAR_WEBHOOK_SECRET: z.string().optional(),
  MOYASAR_BASE_URL: z.string().url().default('https://api.moyasar.com'),
  /**
   * New teams must top up once (or reach KYC level 1) before running postpaid resources.
   * "false" or "0" turns the check off.
   */
  REQUIRE_PREPAID_BEFORE_POSTPAID: z.enum(['true', 'false', '1', '0']).default('true').transform((v) => v === 'true' || v === '1'),
  /** Usage a team may run up per month before that first top up, in the team's currency minor units (halalas for SAR). */
  FREE_ALLOWANCE_MINOR: z.coerce.number().int().min(0).default(0),
  /** Seller details printed on invoices. */
  COMPANY_NAME: z.string().default('Progrid'),
  COMPANY_ADDRESS: z.string().default('Saudi Arabia'),
  COMPANY_TAX_ID: z.string().optional(),
  CONSOLE_URL: z.string().url().default('http://localhost:3000'),
  MAIL_PROVIDER: z.enum(['log', 'postmark', 'resend']).default('log'),
  MAIL_FROM: z.string().default('Progrid <no-reply@progrid.sa>'),
  /** Where new support tickets and customer replies are mailed for the on duty engineer. Empty disables. */
  SUPPORT_INBOX: z.string().default('support@progrid.sa'),
  /** Shared secret the mail provider sends with inbound email webhooks (POST /v1/support/inbound). Empty disables intake. */
  SUPPORT_INBOUND_SECRET: z.string().optional(),
  /** App Platform: hostnames are <app>.<APPS_DOMAIN>; the zone must be hosted on the platform's DNS. */
  APPS_DOMAIN: z.string().default('apps.progrid.sa'),
  /** Server size for shared app hosts; the platform adds one when a region is full. */
  APP_HOST_SIZE: z.string().default('s-4vcpu-8gb'),
  ACME_EMAIL: z.string().default('hostmaster@progrid.sa'),
  MAIL_API_KEY: z.string().optional(),
  /** When true, team owners must enable two factor sign in before using the console. */
  /** Staff must have two factor sign in before any back office call. */
  REQUIRE_TOTP_FOR_STAFF: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  REQUIRE_TOTP_FOR_OWNERS: z.coerce.boolean().default(false),
  OBJECT_STORAGE_PROVIDER: z.enum(['fake', 'rgw']).default('fake'),
  /** Public S3 endpoint customers use, e.g. https://s3.sa1.progrid.sa */
  S3_ENDPOINT: z.string().url().default('http://localhost:4000/_fake-s3'),
  S3_REGION: z.string().default('sa1'),
  RGW_ADMIN_URL: z.string().url().optional(),
  RGW_ADMIN_ACCESS_KEY: z.string().optional(),
  RGW_ADMIN_SECRET_KEY: z.string().optional(),
  DNS_PROVIDER: z.enum(['fake', 'powerdns']).default('fake'),
  PDNS_API_URL: z.string().url().default('http://localhost:8081'),
  PDNS_API_KEY: z.string().optional(),
  /** Comma separated, published as the NS set of every zone and shown to customers. */
  DNS_NAMESERVERS: z.string().default('ns1.progrid.sa,ns2.progrid.sa'),
  DNS_HOSTMASTER: z.string().default('hostmaster.progrid.sa'),
  FX_PROVIDER_URL: z.string().url().default('https://open.er-api.com/v6/latest/USD'),
  /** Where the control plane reaches platform VMs from. SSH and the agents on :9009 accept only this range. */
  CONTROL_PLANE_CIDR: z.string().regex(/^[0-9a-fA-F.:]+\/\d{1,3}$/).default('10.0.0.0/12'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Parsed, validated environment. Fails fast at boot on a bad config. */
export function loadConfig(): AppConfig {
  if (!cached) {
    cached = schema.parse(process.env);
    if (cached.NODE_ENV === 'production' && cached.JWT_SECRET === 'dev-only-secret-change-me') {
      throw new Error('JWT_SECRET still has the development default; set a real secret before running in production');
    }
  }
  return cached;
}
