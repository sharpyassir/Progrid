/**
 * The main console navigation: four groups (Cloud, Build, Connect, Account), each split into
 * short sections. Every live console page is reachable from here; roadmap items open their
 * "coming soon" page under /products/<slug>. Labels are i18n keys so the menu reads in every language.
 */
import type { StringKey as Key } from './i18n';

export type NavGroupId = 'cloud' | 'build' | 'connect' | 'account';

export interface NavItem {
  label: Key;
  href: string;
  /** Roadmap item: shown with a "Soon" badge. */
  soon?: boolean;
  /** Leaves the console (opens in a new tab). An href starting with @www is on the website of this domain. */
  external?: boolean;
}
export interface NavSection { label: Key; items: NavItem[] }
export interface NavGroup { id: NavGroupId; label: Key; description: Key; home: string; sections: NavSection[] }

export const NAV: NavGroup[] = [
  {
    id: 'cloud', label: 'navCloud', description: 'navCloudDesc', home: '/servers',
    sections: [
      { label: 'navSecCompute', items: [
        { label: 'niServers', href: '/servers' }, { label: 'niSnapshots', href: '/snapshots' }, { label: 'niKubernetes', href: '/kubernetes' },
        { label: 'niGpu', href: '/products/gpu-servers', soon: true },
      ] },
      { label: 'navSecDatabases', items: [{ label: 'niDatabases', href: '/databases' }, { label: 'niCaching', href: '/products/caching', soon: true }] },
      { label: 'navSecStorage', items: [{ label: 'niVolumes', href: '/volumes' }, { label: 'niObjectStorage', href: '/buckets' }] },
      { label: 'navSecNetworking', items: [
        { label: 'niFirewalls', href: '/firewalls' }, { label: 'niLoadBalancers', href: '/load-balancers' }, { label: 'niDns', href: '/dns' },
        { label: 'niPublicIps', href: '/public-ips' }, { label: 'niPrivateNetworks', href: '/products/vpc', soon: true },
      ] },
      { label: 'navSecOperations', items: [{ label: 'niMonitoring', href: '/monitoring' }, { label: 'niSshKeys', href: '/ssh-keys' }] },
    ],
  },
  {
    id: 'build', label: 'navBuild', description: 'navBuildDesc', home: '/app-platform',
    sections: [
      { label: 'navSecApps', items: [{ label: 'niAppPlatform', href: '/app-platform' }, { label: 'niOneClick', href: '/apps' }, { label: 'niAiStarter', href: '/servers/new?app=ai-starter' }] },
      { label: 'navSecDeployments', items: [{ label: 'niGitDeploy', href: '/deploys' }] },
      { label: 'navSecApis', items: [
        { label: 'niApiDocs', href: '@www/docs', external: true }, { label: 'niMcp', href: '/agents#mcp' },
        { label: 'niApprovals', href: '/approvals' }, { label: 'niEventWebhooks', href: '/webhooks' },
      ] },
      { label: 'navSecSoon', items: [
        { label: 'niInference', href: '/products/inference', soon: true }, { label: 'niDedicatedInference', href: '/products/dedicated-inference', soon: true },
        { label: 'niAgentWorkspaces', href: '/products/agent-workspaces', soon: true }, { label: 'niVendor', href: '/products/vendor', soon: true },
      ] },
    ],
  },
  {
    id: 'connect', label: 'navConnect', description: 'navConnectDesc', home: '/connect',
    sections: [
      { label: 'navSecAgents', items: [
        { label: 'niConnectHome', href: '/connect' }, { label: 'niAgents', href: '/connect/agents' }, { label: 'niWorkflows', href: '/connect/workflows' },
        { label: 'niConnections', href: '/connect/connections' }, { label: 'niWebhooks', href: '/connect/webhooks' }, { label: 'niLogs', href: '/connect/logs' },
        { label: 'niTemplates', href: '/connect/templates' }, { label: 'niKnowledgeBase', href: '/products/knowledge-base', soon: true },
      ] },
    ],
  },
  {
    id: 'account', label: 'navAccount', description: 'navAccountDesc', home: '/billing',
    sections: [
      { label: 'navSecBilling', items: [{ label: 'niBilling', href: '/billing' }, { label: 'niUsage', href: '/billing#usage' }, { label: 'niProjects', href: '/projects' }] },
      { label: 'navSecAccess', items: [
        { label: 'niApiKeys', href: '/agents' }, { label: 'niTeam', href: '/team' }, { label: 'niSecurity', href: '/security' }, { label: 'niAudit', href: '/audit' },
      ] },
      { label: 'navSecHelp', items: [{ label: 'niSupport', href: '/support' }, { label: 'niManaged', href: '/managed' }] },
    ],
  },
];

const pathOf = (href: string) => href.split(/[?#]/)[0];

/** Does this item own the current path? "/connect" only matches itself so it does not light up for every Connect page. */
export function itemActive(item: NavItem, pathname: string) {
  if (item.external || item.soon) return false;
  const p = pathOf(item.href);
  if (p === '/connect') return pathname === p;
  return pathname === p || pathname.startsWith(`${p}/`);
}

/** The group that holds the current page, for highlighting its menu button. */
export function activeGroup(pathname: string): NavGroupId | null {
  if (pathname.startsWith('/connect')) return 'connect';
  for (const g of NAV) if (g.sections.some((s) => s.items.some((i) => itemActive(i, pathname)))) return g.id;
  return null;
}
