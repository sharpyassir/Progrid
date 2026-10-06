/**
 * The only interface through which the control plane touches a hypervisor.
 * See docs/adr/0002-hypervisor-driver.md.
 *
 * `hostRef` / `vmRef` are opaque JSON strings stored in Host.driverRef / Server.driverRef.
 * Nothing outside the driver may parse them.
 */

export interface VmSpec {
  serverId: string;
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  /** Image driverRef (e.g. Proxmox template), or a snapshot driverRef to clone that snapshot */
  imageRef: string;
  sshKeys: string[];
  /** cloud-init user-data (already rendered) */
  userData?: string;
  /** Tenant overlay network id (VPC). MVP: one default overlay per project. */
  networkRef: string;
  publicIp?: { address: string; gateway: string; prefix: number };
  /**
   * Static address on the private NIC (net0), allocated by the control plane from the
   * project's private network. No gateway: the default route stays on the public NIC.
   * Without it the agent falls back to DHCP on net0.
   */
  privateIp?: { address: string; prefix: number };
  /** The project's SDN VNet for net0 (PRIVATE_NETWORK_MODE=sdn_vnet); the host's shared bridge when absent. */
  privateBridge?: string;
  hostname: string;
  /**
   * Stable key for this create attempt (the workflow id). Retries of the same attempt reuse
   * it so the agent answers with the VM it already made instead of cloning a second one.
   */
  requestKey?: string;
}

export interface VmHandle {
  vmRef: string;
  privateIp?: string;
}

export type VmPowerState = 'running' | 'stopped' | 'unknown';

export interface VmStatus {
  power: VmPowerState;
  cpuPercent?: number;
  memoryUsedMb?: number;
  uptimeSec?: number;
  /** Addresses the guest reports through the QEMU guest agent (waitForBoot only, when it answers). */
  guestAddresses?: string[];
}

export interface FirewallRuleSpec {
  direction: 'inbound' | 'outbound';
  protocol: 'tcp' | 'udp' | 'icmp' | 'vrrp' | 'any';
  ports?: string;
  cidrs: string[];
  /**
   * accept (default) or drop. Drop rules are platform guard rails (tenant isolation, SMTP): they
   * are evaluated before every accept rule and travel to the host agent in a separate list, so
   * an agent that predates them ignores them instead of turning them into accept rules.
   */
  action?: 'accept' | 'drop';
  /** Limits the rule to one NIC of the VM, e.g. "net0" (the private NIC). */
  iface?: string;
}

/** A project's VNet in the Proxmox SDN VXLAN zone. */
export interface PrivateNetworkSpec {
  vnet: string;
  zone: string;
  tag: number;
  alias?: string;
}

/**
 * Addresses each NIC may send from, for the hypervisor's IP filter: "net0" (private) and
 * "net1" (public, plus a cluster VIP the node may hold).
 */
export type NicAddresses = Record<string, string[]>;

export interface VolumeHandle {
  volumeRef: string;
}

export interface HypervisorDriver {
  readonly name: string;

  /** Allocates a block image on the cluster storage (not tied to a VM). */
  createVolume(hostRef: string, spec: { volumeId: string; sizeGb: number }): Promise<VolumeHandle>;
  /** Hot plugs the image into the VM; returns the guest facing device path. */
  attachVolume(hostRef: string, vmRef: string, volumeRef: string, serial: string): Promise<{ device: string }>;
  detachVolume(hostRef: string, vmRef: string, volumeRef: string): Promise<void>;
  /** Grows the image; when attached the guest sees the new size at once. */
  resizeVolume(hostRef: string, volumeRef: string, sizeGb: number, attachedTo?: string): Promise<void>;
  deleteVolume(hostRef: string, volumeRef: string): Promise<void>;

  createVm(hostRef: string, spec: VmSpec): Promise<VmHandle>;
  /** Blocks until cloud-init has finished or the timeout elapses. */
  waitForBoot(hostRef: string, vmRef: string, timeoutMs: number): Promise<VmStatus>;
  startVm(hostRef: string, vmRef: string): Promise<void>;
  stopVm(hostRef: string, vmRef: string, opts?: { force?: boolean }): Promise<void>;
  rebootVm(hostRef: string, vmRef: string): Promise<void>;
  deleteVm(hostRef: string, vmRef: string): Promise<void>;
  resizeVm(hostRef: string, vmRef: string, size: { vcpu: number; memoryMb: number; diskGb: number }): Promise<void>;
  getVmStatus(hostRef: string, vmRef: string): Promise<VmStatus>;
  /** vmRefs of the VMs on the host that carry the tag (every VM is tagged `server-<id>`). */
  findVmsByTag(hostRef: string, tag: string): Promise<string[]>;

  snapshotVm(hostRef: string, vmRef: string, snapshotId: string): Promise<{ snapshotRef: string; sizeGb: number }>;
  deleteSnapshot(hostRef: string, snapshotRef: string): Promise<void>;
  /** Rolls the VM's disks back to its own snapshot. The VM must be stopped. */
  rollbackVm(hostRef: string, vmRef: string, snapshotRef: string): Promise<void>;

  attachPublicIp(hostRef: string, vmRef: string, ip: { address: string; gateway: string; prefix: number }): Promise<void>;
  detachPublicIp(hostRef: string, vmRef: string, address: string): Promise<void>;
  /** Replaces the VM's rules; with `addresses`, also turns on the IP filter for the NICs they confirm. */
  applyFirewall(hostRef: string, vmRef: string, rules: FirewallRuleSpec[], addresses?: NicAddresses): Promise<void>;
  /**
   * Creates the project's VNet in the SDN zone if missing and applies the SDN config. The SDN
   * is cluster wide, so asking the agent of any one host of the region is enough.
   */
  ensurePrivateNetwork(hostRef: string, net: PrivateNetworkSpec): Promise<void>;
}

export const HYPERVISOR_DRIVER = Symbol('HYPERVISOR_DRIVER');
