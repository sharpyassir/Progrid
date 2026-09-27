import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NatsService, Subjects } from '../common/nats/nats.service';
import { Job, JobKind, JobResult } from './agent-protocol';
import { FirewallRuleSpec, HypervisorDriver, VmHandle, VmSpec, VmStatus } from './hypervisor.driver';

/** Error raised when the host agent reports a failure. `retryable` drives Temporal retry policy. */
export class AgentJobError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

interface ProxmoxHostRef {
  hostId: string;
  node: string;
}

/**
 * Proxmox VE driver. The control plane never calls Proxmox itself: every operation is a
 * job sent over NATS to the host agent running on the target node, which calls the
 * local Proxmox API. That keeps the data plane independent of the control plane.
 */
@Injectable()
export class ProxmoxDriver implements HypervisorDriver {
  readonly name = 'proxmox';
  private readonly log = new Logger(ProxmoxDriver.name);

  constructor(private readonly nats: NatsService) {}

  /**
   * Sends one job. `jobId` defaults to a random id; pass a deterministic one for jobs that
   * must not run twice when the request is retried (the agent answers a repeated id with the
   * stored result, or waits for the run in progress).
   */
  private async job<R = Record<string, unknown>>(hostRef: string, kind: JobKind, params: Record<string, unknown>, timeoutMs = 120_000, jobId?: string): Promise<R> {
    const host = JSON.parse(hostRef) as ProxmoxHostRef;
    const job: Job = { id: jobId ?? randomUUID(), kind, params: { node: host.node, ...params }, issuedAt: new Date().toISOString() };
    this.log.debug(`→ ${host.node} ${kind} ${job.id}`);
    const res = await this.nats.request<Job, JobResult<R>>(Subjects.hostJobs(host.hostId), job, timeoutMs);
    if (!res.ok) {
      const e = res.error ?? { code: 'unknown', message: 'agent returned no error detail', retryable: true };
      throw new AgentJobError(e.code, `${kind} on ${host.node}: ${e.message}`, e.retryable);
    }
    return res.result as R;
  }

  createVolume(hostRef: string, spec: { volumeId: string; sizeGb: number }) {
    return this.job<{ volumeRef: string }>(hostRef, 'volume.create', spec, 180_000);
  }
  attachVolume(hostRef: string, vmRef: string, volumeRef: string, serial: string) {
    return this.job<{ device: string }>(hostRef, 'volume.attach', { vmRef, volumeRef, serial });
  }
  async detachVolume(hostRef: string, vmRef: string, volumeRef: string) {
    await this.job(hostRef, 'volume.detach', { vmRef, volumeRef });
  }
  async resizeVolume(hostRef: string, volumeRef: string, sizeGb: number, attachedTo?: string) {
    await this.job(hostRef, 'volume.resize', { volumeRef, sizeGb, vmRef: attachedTo }, 300_000);
  }
  async deleteVolume(hostRef: string, volumeRef: string) {
    await this.job(hostRef, 'volume.delete', { volumeRef }, 300_000);
  }

  /** A full clone can take 10 minutes; the id is derived from the server so retries never clone twice. */
  createVm(hostRef: string, spec: VmSpec): Promise<VmHandle> {
    const { requestKey, ...rest } = spec;
    const id = `vm.create:${spec.serverId}${requestKey ? `:${requestKey}` : ''}`;
    return this.job<VmHandle>(hostRef, 'vm.create', { spec: rest }, 600_000, id);
  }
  waitForBoot(hostRef: string, vmRef: string, timeoutMs: number): Promise<VmStatus> {
    return this.job<VmStatus>(hostRef, 'vm.wait_boot', { vmRef, timeoutMs }, timeoutMs + 10_000);
  }
  async startVm(hostRef: string, vmRef: string) {
    await this.job(hostRef, 'vm.start', { vmRef });
  }
  async stopVm(hostRef: string, vmRef: string, opts: { force?: boolean } = {}) {
    await this.job(hostRef, 'vm.stop', { vmRef, force: !!opts.force });
  }
  async rebootVm(hostRef: string, vmRef: string) {
    await this.job(hostRef, 'vm.reboot', { vmRef });
  }
  async deleteVm(hostRef: string, vmRef: string) {
    await this.job(hostRef, 'vm.delete', { vmRef });
  }
  async resizeVm(hostRef: string, vmRef: string, size: { vcpu: number; memoryMb: number; diskGb: number }) {
    await this.job(hostRef, 'vm.resize', { vmRef, ...size }, 300_000);
  }
  getVmStatus(hostRef: string, vmRef: string): Promise<VmStatus> {
    return this.job<VmStatus>(hostRef, 'vm.status', { vmRef }, 15_000);
  }
  async findVmsByTag(hostRef: string, tag: string): Promise<string[]> {
    return (await this.job<{ vmRefs: string[] }>(hostRef, 'vm.find_by_tag', { tag }, 30_000)).vmRefs ?? [];
  }
  snapshotVm(hostRef: string, vmRef: string, snapshotId: string) {
    return this.job<{ snapshotRef: string; sizeGb: number }>(hostRef, 'vm.snapshot', { vmRef, snapshotId }, 600_000);
  }
  async deleteSnapshot(hostRef: string, snapshotRef: string) {
    await this.job(hostRef, 'snapshot.delete', { snapshotRef });
  }
  async rollbackVm(hostRef: string, vmRef: string, snapshotRef: string) {
    await this.job(hostRef, 'vm.rollback', { vmRef, snapshotRef }, 600_000);
  }
  async attachPublicIp(hostRef: string, vmRef: string, ip: { address: string; gateway: string; prefix: number }) {
    await this.job(hostRef, 'net.attach_ip', { vmRef, ip });
  }
  async detachPublicIp(hostRef: string, vmRef: string, address: string) {
    await this.job(hostRef, 'net.detach_ip', { vmRef, address });
  }
  async applyFirewall(hostRef: string, vmRef: string, rules: FirewallRuleSpec[]) {
    await this.job(hostRef, 'net.apply_firewall', { vmRef, rules });
  }
}
