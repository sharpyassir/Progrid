import { Injectable, Logger } from '@nestjs/common';
import { FirewallRuleSpec, HypervisorDriver, VmHandle, VmSpec, VmStatus } from './hypervisor.driver';

interface FakeVm {
  spec: VmSpec;
  power: 'running' | 'stopped';
  bootedAt: number;
  ips: string[];
  rules: FirewallRuleSpec[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * In-memory hypervisor for local development and tests. "Boots" a VM in ~2 seconds.
 * State lives in the worker process; restarting the worker forgets every VM.
 */
@Injectable()
export class FakeDriver implements HypervisorDriver {
  readonly name = 'fake';
  private readonly log = new Logger(FakeDriver.name);
  private readonly vms = new Map<string, FakeVm>();
  private readonly volumes = new Map<string, { sizeGb: number; attachedTo?: string }>();
  private nextId = 100;

  async createVolume(_h: string, spec: { volumeId: string; sizeGb: number }) {
    await sleep(200);
    const volumeRef = JSON.stringify({ fake: true, storage: 'vm-disks', volume: `vm-900000-vol-${spec.volumeId}` });
    this.volumes.set(volumeRef, { sizeGb: spec.sizeGb });
    return { volumeRef };
  }
  async attachVolume(_h: string, vmRef: string, volumeRef: string, serial: string) {
    await sleep(200);
    const v = this.volumes.get(volumeRef);
    if (v) v.attachedTo = vmRef;
    return { device: `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_${serial}` };
  }
  async detachVolume(_h: string, _vmRef: string, volumeRef: string) {
    await sleep(200);
    const v = this.volumes.get(volumeRef);
    if (v) v.attachedTo = undefined;
  }
  async resizeVolume(_h: string, volumeRef: string, sizeGb: number) {
    const v = this.volumes.get(volumeRef);
    if (v) v.sizeGb = sizeGb;
  }
  async deleteVolume(_h: string, volumeRef: string) {
    this.volumes.delete(volumeRef);
  }

  async createVm(hostRef: string, spec: VmSpec): Promise<VmHandle> {
    await sleep(300);
    const vmRef = JSON.stringify({ fake: true, vmid: this.nextId++, host: JSON.parse(hostRef).node ?? 'fake1' });
    const privateIp = spec.privateIp?.address ?? `10.10.${Math.floor(this.nextId / 250)}.${this.nextId % 250}`;
    this.vms.set(vmRef, { spec, power: 'running', bootedAt: Date.now(), ips: [], rules: [] });
    this.log.debug(`created ${spec.name} → ${vmRef}`);
    return { vmRef, privateIp };
  }

  async waitForBoot(_h: string, vmRef: string, timeoutMs: number): Promise<VmStatus> {
    const vm = this.mustGet(vmRef);
    const remaining = Math.max(0, vm.bootedAt + 2000 - Date.now());
    await sleep(Math.min(remaining, timeoutMs));
    return { power: 'running', uptimeSec: Math.floor((Date.now() - vm.bootedAt) / 1000) };
  }

  async startVm(_h: string, vmRef: string) {
    this.mustGet(vmRef).power = 'running';
  }
  async stopVm(_h: string, vmRef: string) {
    this.mustGet(vmRef).power = 'stopped';
  }
  async rebootVm(_h: string, vmRef: string) {
    const vm = this.mustGet(vmRef);
    vm.power = 'stopped';
    await sleep(500);
    vm.power = 'running';
  }
  async deleteVm(_h: string, vmRef: string) {
    this.vms.delete(vmRef); // idempotent
  }
  async resizeVm(_h: string, vmRef: string, size: { vcpu: number; memoryMb: number; diskGb: number }) {
    Object.assign(this.mustGet(vmRef).spec, size);
  }
  async getVmStatus(_h: string, vmRef: string): Promise<VmStatus> {
    const vm = this.vms.get(vmRef);
    if (!vm) return { power: 'unknown' };
    return { power: vm.power, cpuPercent: Math.random() * 10, memoryUsedMb: Math.floor(vm.spec.memoryMb * 0.3) };
  }
  async findVmsByTag(_h: string, tag: string) {
    return [...this.vms.entries()].filter(([, vm]) => `server-${vm.spec.serverId}` === tag).map(([ref]) => ref);
  }
  async snapshotVm(_h: string, vmRef: string, snapshotId: string) {
    // A worker restart forgets in memory VMs; snapshots of unknown refs still succeed so daily backups keep working in dev.
    const vm = this.vms.get(vmRef);
    await sleep(500);
    return { snapshotRef: JSON.stringify({ fake: true, vmRef, snapshotId }), sizeGb: (vm?.spec.diskGb ?? 25) * 0.4 };
  }
  async deleteSnapshot() {}
  async rollbackVm(_h: string, vmRef: string) {
    await sleep(500);
    const vm = this.vms.get(vmRef);
    if (vm) vm.power = 'stopped';
  }
  // These three are called from the API process, which does not share memory with the
  // worker that created the VM. Unknown refs are accepted so the dev console stays usable.
  async attachPublicIp(_h: string, vmRef: string, ip: { address: string }) {
    this.vms.get(vmRef)?.ips.push(ip.address);
  }
  async detachPublicIp(_h: string, vmRef: string, address: string) {
    const vm = this.vms.get(vmRef);
    if (vm) vm.ips = vm.ips.filter((a) => a !== address);
  }
  async applyFirewall(_h: string, vmRef: string, rules: FirewallRuleSpec[]) {
    const vm = this.vms.get(vmRef);
    if (vm) vm.rules = rules;
  }

  private mustGet(vmRef: string): FakeVm {
    const vm = this.vms.get(vmRef);
    if (!vm) throw new Error(`fake vm ${vmRef} not found`);
    return vm;
  }
}
