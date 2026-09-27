/**
 * Wire protocol between the control plane and the Go host agent over NATS.
 * Mirrored in agents/host-agent/internal/protocol/protocol.go — keep in sync.
 */

export type JobKind =
  | 'vm.create'
  | 'vm.wait_boot'
  | 'vm.start'
  | 'vm.stop'
  | 'vm.reboot'
  | 'vm.delete'
  | 'vm.resize'
  | 'vm.status'
  | 'vm.find_by_tag'
  | 'vm.snapshot'
  | 'vm.rollback'
  | 'snapshot.delete'
  | 'net.attach_ip'
  | 'net.detach_ip'
  | 'net.apply_firewall'
  | 'net.ensure_vnet'
  | 'volume.create'
  | 'volume.attach'
  | 'volume.detach'
  | 'volume.resize'
  | 'volume.delete';

export interface Job<P = Record<string, unknown>> {
  id: string; // agents dedupe on it; a repeated id gets the stored result instead of a second run
  kind: JobKind;
  params: P;
  issuedAt: string;
}

export interface JobResult<R = Record<string, unknown>> {
  jobId: string;
  ok: boolean;
  result?: R;
  error?: { code: string; message: string; retryable: boolean };
}

export interface Heartbeat {
  hostId: string;
  node: string;
  at: string;
  totalVcpu: number;
  totalMemoryMb: number;
  totalDiskGb: number;
  usedVcpu: number;
  usedMemoryMb: number;
  usedDiskGb: number;
  /** serverId comes from the VM's tags; addresses from the guest agent of a running VM, when it answers. */
  vms: Array<{ vmRef: string; power: 'running' | 'stopped'; serverId?: string; addresses?: string[] }>;
  agentVersion: string;
}

/** metrics.v1: raw counters per VM per minute; network and disk are cumulative bytes. */
export interface MetricSampleV1 {
  v: 1;
  at: string;
  serverId: string;
  hostId: string;
  power: string;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  netInBytes: number;
  netOutBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
}

/** usage.v1: one per resource per minute. Bandwidth carries the outbound bytes since the previous tick. */
export interface UsageEventV1 {
  v: 1;
  at: string; // minute-aligned ISO timestamp
  resourceType: 'server' | 'snapshot' | 'public_ip' | 'bandwidth';
  resourceId: string;
  projectId: string;
  hostId: string;
  quantity: number;
  unit: 'minute' | 'gb_minute' | 'byte';
  meta?: Record<string, unknown>;
}
