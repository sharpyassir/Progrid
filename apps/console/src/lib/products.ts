/**
 * The full product surface, grouped the way DigitalOcean's 2026 console groups it
 * (Projects · Managed Agents · Inference Engine · Data & Learning · Core Cloud ·
 * Marketplace · Security). `href` = live today; `phase` = roadmap item that opens the
 * "coming soon / register interest" page. Roadmap source of truth: docs/product-catalog.md.
 */
export type Phase = 'mvp' | 2 | 3;
export type Group = 'Projects' | 'Managed Agents' | 'Inference Engine' | 'Data & Learning' | 'Core Cloud' | 'Marketplace' | 'Security';

export interface Product {
  slug: string;
  name: string;
  group: Group;
  href?: string;
  phase?: Phase;
  blurb: string;
}

export const GROUPS: Group[] = ['Projects', 'Managed Agents', 'Inference Engine', 'Data & Learning', 'Core Cloud', 'Marketplace', 'Security'];

export const PRODUCTS: Product[] = [
  // Projects
  { slug: 'projects', name: 'Projects', group: 'Projects', href: '/projects', blurb: 'Group resources, set quotas and a monthly spend limit per project.' },
  { slug: 'team', name: 'Team', group: 'Projects', href: '/team', blurb: 'Members and roles, invitations, the billing profile printed on invoices, and closing the account.' },

  // Managed Agents: our headline
  { slug: 'agents', name: 'Agent Access', group: 'Managed Agents', href: '/agents', blurb: 'Agent-safe API tokens: scopes, monthly spend caps, human approval for destructive actions.' },
  { slug: 'mcp', name: 'MCP Server', group: 'Managed Agents', href: '/agents#mcp', blurb: 'Use pgcloud as tools from Claude Code, Cursor or any MCP client.' },
  { slug: 'approvals', name: 'Approval Queue', group: 'Managed Agents', href: '/approvals', blurb: 'Review and approve actions your agents request before they run.' },
  { slug: 'agent-workspaces', name: 'Agent Workspaces', group: 'Managed Agents', phase: 2, blurb: 'Sandboxed servers pre-wired for coding agents, with logs and cost per agent.' },

  // Inference Engine
  { slug: 'inference', name: 'Inference Gateway', group: 'Inference Engine', phase: 3, blurb: 'One OpenAI-compatible endpoint, billed per token in TRY or USD.' },
  { slug: 'dedicated-inference', name: 'Dedicated Inference', group: 'Inference Engine', phase: 3, blurb: 'Your own model endpoint on a GPU server.' },
  { slug: 'gpu-servers', name: 'GPU Servers', group: 'Inference Engine', phase: 3, blurb: 'Hourly GPU nodes for inference and fine-tuning.' },
  { slug: 'ai-starter', name: 'AI Starter (Ollama + Open WebUI)', group: 'Inference Engine', href: '/servers/new?app=ai-starter', blurb: 'Run open models on CPU today with a chat UI in one click.' },

  // Data & Learning
  { slug: 'databases', name: 'Managed Databases', group: 'Data & Learning', href: '/databases', blurb: 'PostgreSQL with pgvector, Valkey and MySQL: automatic failover, nightly backups, TLS.' },
  { slug: 'caching', name: 'Caching', group: 'Data & Learning', phase: 3, blurb: 'Managed Redis / Valkey.' },
  { slug: 'knowledge-base', name: 'Knowledge Base', group: 'Data & Learning', phase: 3, blurb: 'RAG over your documents, served through the inference gateway.' },

  // Core Cloud
  { slug: 'servers', name: 'Servers', group: 'Core Cloud', href: '/servers', blurb: 'KVM virtual machines in Saudi Arabia, billed hourly and capped monthly.' },
  { slug: 'app-platform', name: 'App Platform', group: 'Core Cloud', href: '/app-platform', blurb: 'Push code, get a URL: containers on shared hosts with TLS, sized per instance, redeployed on every push.' },
  { slug: 'deploys', name: 'Git Deploy', group: 'Core Cloud', href: '/deploys', blurb: 'Link a GitHub repo; we build and run it on your own server, and redeploy on every push.' },
  { slug: 'kubernetes', name: 'Kubernetes', group: 'Core Cloud', href: '/kubernetes', blurb: 'Clusters we bootstrap and keep healthy: node pools as servers, load balancers and volumes from Services and claims.' },
  { slug: 'public-ips', name: 'Public IPs', group: 'Core Cloud', href: '/public-ips', blurb: 'IPv4 addresses from our own blocks. Floating IPs come in phase 2.' },
  { slug: 'vpc', name: 'VPC', group: 'Core Cloud', phase: 2, blurb: 'Isolated private networks per project (VXLAN / EVPN).' },
  { slug: 'load-balancers', name: 'Load Balancers', group: 'Core Cloud', href: '/load-balancers', blurb: 'Managed HAProxy with a public IP, health checks, sticky sessions and free TLS.' },
  { slug: 'dns', name: 'DNS', group: 'Core Cloud', href: '/dns', blurb: 'Hosted zones, every record type and reverse DNS, free with your account.' },
  { slug: 'snapshots', name: 'Snapshots', group: 'Core Cloud', href: '/snapshots', blurb: 'Point-in-time copies of a server.' },
  { slug: 'volumes', name: 'Volumes', group: 'Core Cloud', href: '/volumes', blurb: 'Block storage from 10 GB to 16 TB, attached to any server, grown live.' },
  { slug: 'object-storage', name: 'Object Storage', group: 'Core Cloud', href: '/buckets', blurb: 'S3 compatible buckets on Ceph, any S3 client, per GB pricing.' },
  { slug: 'monitoring', name: 'Monitoring & Alerts', group: 'Core Cloud', href: '/monitoring', blurb: 'Metrics from every server, alert rules to email and webhook.' },
  { slug: 'webhooks', name: 'Webhooks', group: 'Core Cloud', href: '/webhooks', blurb: 'Signed event deliveries: server.active, invoice.issued, spend.limit_reached…' },

  // Marketplace
  { slug: 'apps', name: 'One-click Apps', group: 'Marketplace', href: '/apps', blurb: 'WordPress, n8n, Odoo, Coolify, AI starter and more.' },
  { slug: 'vendor', name: 'Vendor Portal', group: 'Marketplace', phase: 3, blurb: 'Publish your software as a paid app with revenue share.' },

  // Security
  { slug: 'firewalls', name: 'Firewalls', group: 'Security', href: '/firewalls', blurb: 'Host-enforced firewall rules, attached to any server.' },
  { slug: 'ssh-keys', name: 'SSH Keys', group: 'Security', href: '/ssh-keys', blurb: 'Public keys injected into every server you create.' },
  { slug: 'audit', name: 'Audit Log', group: 'Security', href: '/audit', blurb: 'Every API call by every user, token and agent.' },
  { slug: 'two-factor', name: 'Two Factor Sign In', group: 'Security', href: '/security', blurb: 'Authenticator app codes and recovery codes, required for team owners.' },
];

export function phaseLabel(p: Phase) {
  return p === 'mvp' ? 'MVP' : `Phase ${p}`;
}
