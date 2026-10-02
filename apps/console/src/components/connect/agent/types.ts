import type { AgentDetail } from '@/lib/connect';

export type AgentTab = 'overview' | 'instructions' | 'tools' | 'workflow' | 'test' | 'deploy' | 'api' | 'logs' | 'usage' | 'versions';
export interface AgentTabProps { agent: AgentDetail; reload: () => Promise<void>; setTab: (t: AgentTab) => void }
