export interface PlatformApp {
  id: string; name: string; status: string; statusMessage: string | null; url: string; hostname: string; customDomains: string[];
  region: { id: string; name: string }; repoUrl: string; repo: string | null; source: 'github_app' | 'url'; branch: string; port: number;
  size: { id: string; memoryMb: number; cpus: number }; instances: number; healthPath: string | null; preDeployCommand: string | null; env: Record<string, string>;
  hostIp: string | null; lastCommit: string | null; lastDeployAt: string | null;
  deploys: { id: string; status: string; trigger: string; commit: string | null; startedAt: string; finishedAt: string | null }[];
  projectId: string; createdAt: string;
}
export interface AppSize { id: string; memoryMb: number; cpus: number }
export const APP_STATUS_BADGE: Record<string, string> = { live: 'active', building: 'provisioning', creating: 'provisioning', stopped: 'off' };

/** A console run: a one off command in a container from the app's live image. */
export interface AppRun {
  id: string; appId: string; command: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'canceled'; exitCode: number | null;
  timeoutSeconds: number; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; output?: string;
}
export const RUN_STATUS_BADGE: Record<string, string> = { succeeded: 'active', failed: 'failed', timed_out: 'failed', canceled: 'off', running: 'provisioning', queued: 'provisioning' };
export const RUN_ACTIVE = ['queued', 'running'];

/** A managed database attached to an app (no password; the URL comes from the credentials call). */
export interface AppDatabaseLink { id: string; databaseId: string; databaseName: string; engine: 'postgres' | 'mysql' | 'valkey'; envName: string; dbName: string | null; dbUser: string; createdAt: string }

export function duration(ms: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
