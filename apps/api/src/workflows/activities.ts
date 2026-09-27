import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { ApplicationFailure, Context } from '@temporalio/activity';
import type { DbClusterStatus, KubeClusterStatus, PlatformAppStatus, LoadBalancerStatus, ServerStatus, VolumeStatus } from '@prisma/client';
import { LoadBalancersService } from '../modules/lb/lb.service';
import { DatabasesService } from '../modules/databases/db.service';
import { KubernetesService } from '../modules/kubernetes/k8s.service';
import { AppPlatformService, hostReady } from '../modules/app-platform/app.service';
import { TemporalService } from '../common/temporal/temporal.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { HYPERVISOR_DRIVER, HypervisorDriver } from '../drivers/hypervisor.driver';
import { AgentJobError } from '../drivers/proxmox.driver';
import { SchedulerService } from '../modules/scheduler/scheduler.service';
import { IpsService } from '../modules/network/ips.service';
import { FirewallsService } from '../modules/network/firewalls.service';
import { PrivateNetworksService } from '../modules/network/private-networks.service';
import { EventsService } from '../modules/events/events.service';
import { ApiError } from '../common/errors/api-error';

/**
 * Activities are the only place workflows touch the database or the hypervisor.
 * Every activity is idempotent by serverId so Temporal can retry it safely.
 */
export interface Activities {
  setStatus(serverId: string, status: ServerStatus, message?: string): Promise<void>;
  setImage(serverId: string, imageId: string): Promise<void>;
  placeServer(serverId: string, avoid: string[]): Promise<void>;
  reserveIp(serverId: string): Promise<void>;
  createVm(serverId: string): Promise<void>;
  waitForBoot(serverId: string): Promise<void>;
  reattachVolumes(serverId: string): Promise<void>;
  applyFirewall(serverId: string): Promise<void>;
  startMeter(serverId: string): Promise<void>;
  compensateCreate(serverId: string): Promise<void>;
  powerOp(serverId: string, op: 'start' | 'stop' | 'reboot', force: boolean): Promise<void>;
  isRunning(serverId: string): Promise<boolean>;
  syncStatusFromHypervisor(serverId: string, message: string): Promise<void>;
  resizeVm(serverId: string, sizeId: string): Promise<void>;
  deleteVm(serverId: string): Promise<void>;
  finalizeDelete(serverId: string): Promise<void>;
  createSnapshotRecord(serverId: string, name: string, kind?: 'manual' | 'backup'): Promise<string>;
  snapshotVm(serverId: string, snapshotId: string): Promise<void>;
  rollbackVm(serverId: string, snapshotId: string): Promise<void>;
  failSnapshot(snapshotId: string, message: string): Promise<void>;
  deleteSnapshotVm(snapshotId: string): Promise<void>;
  volumeCreate(volumeId: string): Promise<void>;
  volumeAttach(volumeId: string, serverId: string): Promise<{ device: string }>;
  volumeDetach(volumeId: string): Promise<void>;
  volumeResize(volumeId: string, sizeGb: number): Promise<void>;
  volumeDelete(volumeId: string): Promise<void>;
  setVolumeStatus(volumeId: string, status: VolumeStatus, message?: string): Promise<void>;
  emitVolume(name: string, volumeId: string, payload: Record<string, unknown>): Promise<void>;
  lbWaitNodes(lbId: string): Promise<void>;
  lbPushConfig(lbId: string): Promise<{ applied: number; nodes: number }>;
  lbSetStatus(lbId: string, status: LoadBalancerStatus, message?: string): Promise<void>;
  lbDeleteNodes(lbId: string): Promise<void>;
  lbWaitNodesGone(lbId: string): Promise<void>;
  lbFinalizeDelete(lbId: string): Promise<void>;
  emitLb(name: string, lbId: string, payload: Record<string, unknown>): Promise<void>;
  dbWaitNodes(clusterId: string): Promise<void>;
  dbPushConfig(clusterId: string): Promise<{ applied: number; nodes: number; waiting: string[]; errors: string[] }>;
  dbWaitApplied(clusterId: string, timeoutMinutes: number): Promise<void>;
  dbRestore(clusterId: string, backupId: string): Promise<void>;
  dbSetStatus(clusterId: string, status: DbClusterStatus, message?: string): Promise<void>;
  dbDeleteNodes(clusterId: string): Promise<void>;
  dbWaitNodesGone(clusterId: string): Promise<void>;
  k8sWaitNodes(clusterId: string): Promise<void>;
  k8sPushConfig(clusterId: string): Promise<{ applied: number; nodes: number }>;
  k8sWaitBootstrap(clusterId: string): Promise<void>;
  k8sSetStatus(clusterId: string, status: KubeClusterStatus, message?: string): Promise<void>;
  k8sDeleteCloud(clusterId: string): Promise<void>;
  k8sDeleteNodes(clusterId: string): Promise<void>;
  k8sWaitNodesGone(clusterId: string): Promise<void>;
  k8sFinalizeDelete(clusterId: string): Promise<void>;
  emitK8s(name: string, clusterId: string, payload: Record<string, unknown>): Promise<void>;
  appPlace(appId: string): Promise<string>;
  appWaitHost(hostId: string): Promise<void>;
  appPushHost(hostId: string): Promise<void>;
  appWaitDeploy(appId: string, deployId: string): Promise<'live' | 'failed'>;
  appSetStatus(appId: string, status: PlatformAppStatus, message?: string): Promise<void>;
  appUpsertDns(appId: string): Promise<void>;
  appFinalizeDelete(appId: string): Promise<void>;
  emitApp(name: string, appId: string, payload: Record<string, unknown>): Promise<void>;
  dbFinalizeDelete(clusterId: string): Promise<void>;
  emitDb(name: string, clusterId: string, payload: Record<string, unknown>): Promise<void>;
  completeAction(actionId: string): Promise<void>;
  failAction(actionId: string, message: string): Promise<void>;
  emit(name: string, serverId: string, payload: Record<string, unknown>): Promise<void>;
}

export function createActivities(app: INestApplicationContext): Activities {
  const log = new Logger('activities');
  const prisma = app.get(PrismaService);
  const driver = app.get<HypervisorDriver>(HYPERVISOR_DRIVER);
  const scheduler = app.get(SchedulerService);
  const ips = app.get(IpsService);
  const firewalls = app.get(FirewallsService);
  const privateNetworks = app.get(PrivateNetworksService);
  const events = app.get(EventsService);
  const lbs = app.get(LoadBalancersService);
  const dbs = app.get(DatabasesService);
  const k8s = app.get(KubernetesService);
  const apps = app.get(AppPlatformService);
  const temporal = app.get(TemporalService);

  /** The snapshot a server is created from, with the host of its source VM. */
  async function sourceSnapshot(snapshotId: string) {
    const snap = await prisma.snapshot.findUnique({ where: { id: snapshotId }, include: { server: true } });
    if (!snap || snap.status !== 'available' || !snap.driverRef) throw nonRetryable(`snapshot ${snapshotId} is not available`);
    if (!snap.server?.hostId || snap.server.deletedAt) throw nonRetryable(`the server snapshot ${snapshotId} was taken from no longer exists`);
    return snap;
  }

  /** Loads a server with everything the driver needs. Throws non-retryable if gone. */
  async function load(serverId: string) {
    const s = await prisma.server.findUnique({ where: { id: serverId }, include: { host: true, image: true, size: true, publicIps: { include: { block: true } }, project: { include: { team: true } } } });
    if (!s) throw nonRetryable(`server ${serverId} no longer exists`);
    return s;
  }

  function hostRef(s: { host: { driverRef: string } | null }) {
    if (!s.host) throw nonRetryable('server has no host');
    return s.host.driverRef;
  }

  function wrap<T>(p: Promise<T>): Promise<T> {
    // Map driver errors so Temporal retries only what the agent says is retryable.
    return p.catch((err) => {
      if (err instanceof AgentJobError && !err.retryable) throw nonRetryable(err.message);
      if (err instanceof ApiError) throw nonRetryable(err.message);
      throw err;
    });
  }

  return {
    async setStatus(serverId, status, message) {
      await prisma.server.update({ where: { id: serverId }, data: { status, statusMessage: message ?? null } });
    },

    async setImage(serverId, imageId) {
      // A rebuild installs the image, so a server made from a snapshot stops cloning it.
      await prisma.server.update({ where: { id: serverId }, data: { imageId, sourceSnapshotId: null } });
    },

    async placeServer(serverId, avoid) {
      const s = await load(serverId);
      if (s.hostId) return; // already placed (retry)
      // A snapshot lives with its source VM, so a clone of it must run on that VM's host.
      const onlyHostId = s.sourceSnapshotId ? (await sourceSnapshot(s.sourceSnapshotId)).server!.hostId! : undefined;
      // Cluster nodes (load balancer, database, Kubernetes) carry a spread group: keep them on different hosts.
      const create = await prisma.serverAction.findFirst({ where: { serverId, type: 'create' }, orderBy: { startedAt: 'asc' }, select: { params: true } });
      const group = (create?.params as { spreadGroup?: string } | null)?.spreadGroup;
      const siblings = group
        ? (await prisma.serverAction.findMany({ where: { type: 'create', params: { path: ['spreadGroup'], equals: group } }, select: { serverId: true } })).map((a) => a.serverId).filter((id) => id !== serverId)
        : [];
      const placement = await wrap(scheduler.place({ regionId: s.regionId, vcpu: s.vcpu, memoryMb: s.memoryMb, diskGb: s.diskGb, avoidServerIds: [...new Set([...avoid, ...siblings])], softAvoid: !!group, serverId, family: s.size.family, onlyHostId }));
      await prisma.server.update({ where: { id: serverId }, data: { hostId: placement.hostId } });
      log.log(`placed ${serverId} on host ${placement.hostId}`);
      if (placement.sharedWithAvoided) {
        log.warn(`${serverId} shares host ${placement.hostId} with another node of ${group}: the region has too few hosts`);
        await events.emit('server.placement_shared_host', { serverId, name: s.name, group, hostId: placement.hostId, reason: 'the region has too few hosts to keep cluster nodes apart' }, { teamId: s.project.teamId, resource: `server:${serverId}` });
      }
    },

    async reserveIp(serverId) {
      const s = await load(serverId);
      if (s.publicIps.length) return;
      await wrap(ips.reserve(s.regionId, s.projectId, serverId));
    },

    async createVm(serverId) {
      const s = await load(serverId);
      if (s.driverRef) return; // VM already created (retry)
      const keys = await prisma.sshKey.findMany({ where: { id: { in: s.sshKeyIds } } });
      const ip = s.publicIps[0];
      // The private address is allocated here, before the VM exists, and kept across retries and rebuilds.
      const priv = await wrap(privateNetworks.reserveForServer(s));
      // Retries of this activity keep the workflow id, so the agent recognizes the repeated create.
      const info = Context.current().info;
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      const handle = await wrap(
        driver.createVm(hostRef(s), {
          serverId: s.id,
          requestKey: info.workflowExecution?.workflowId,
          name: s.name,
          hostname: s.name,
          vcpu: s.vcpu,
          memoryMb: s.memoryMb,
          diskGb: s.diskGb,
          imageRef: s.sourceSnapshotId ? (await sourceSnapshot(s.sourceSnapshotId)).driverRef! : s.image.driverRef ?? s.image.id,
          sshKeys: keys.map((k) => k.publicKey),
          userData: s.userData ?? undefined,
          networkRef: `vpc-${s.projectId}`,
          publicIp: ip ? { address: ip.address, gateway: ip.block.gateway, prefix: IpsService.prefixOf(ip.block.cidr) } : undefined,
          privateIp: { address: priv.address, prefix: priv.prefix },
        }),
      ).finally(() => clearInterval(heartbeat));
      if (handle.privateIp && handle.privateIp !== priv.address) log.warn(`createVm ${serverId}: the driver reports ${handle.privateIp}, keeping the allocated ${priv.address}`);
      await prisma.server.update({ where: { id: serverId }, data: { driverRef: handle.vmRef, privateIp: priv.address } });
    },

    async waitForBoot(serverId) {
      const s = await load(serverId);
      if (!s.driverRef) throw nonRetryable('waitForBoot before createVm');
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      try {
        const status = await wrap(driver.waitForBoot(hostRef(s), s.driverRef, 10 * 60_000));
        if (status.power !== 'running') throw new Error(`VM is ${status.power} after boot`);
        privateNetworks.checkGuestAddresses(s, status.guestAddresses);
      } finally {
        clearInterval(heartbeat);
      }
    },

    async reattachVolumes(serverId) {
      // After a rebuild the new VM has none of the volumes the database still shows attached.
      const s = await load(serverId);
      if (!s.driverRef) throw nonRetryable('server has no VM');
      const vols = await prisma.volume.findMany({ where: { serverId, driverRef: { not: null }, status: { notIn: ['deleting', 'deleted'] } } });
      for (const v of vols) {
        const r = await wrap(driver.attachVolume(hostRef(s), s.driverRef, v.driverRef!, serial(v.id)));
        await prisma.volume.update({ where: { id: v.id }, data: { device: r.device, statusMessage: null } });
      }
    },

    async applyFirewall(serverId) {
      const s = await load(serverId);
      if (!s.driverRef) return;
      await wrap(driver.applyFirewall(hostRef(s), s.driverRef, await firewalls.effectiveRules(serverId)));
    },

    async startMeter(serverId) {
      await prisma.server.updateMany({ where: { id: serverId, meteredSince: null }, data: { meteredSince: new Date() } });
    },

    async compensateCreate(serverId) {
      const s = await prisma.server.findUnique({ where: { id: serverId }, include: { host: true } });
      if (!s) return;
      if (s.host) {
        // A create whose reply was lost leaves a VM the database does not know; find it by its tag.
        const refs = new Set<string>(s.driverRef ? [s.driverRef] : []);
        const tagged = await driver.findVmsByTag(s.host.driverRef, `server-${serverId}`).catch((e) => {
          log.warn(`compensate: findVmsByTag ${serverId}: ${e.message}`);
          return [] as string[];
        });
        for (const r of tagged) refs.add(r);
        for (const r of refs) {
          await driver.deleteVm(s.host.driverRef, r).catch((e) => log.warn(`compensate: deleteVm ${serverId} ${r}: ${e.message}`));
        }
      }
      await ips.releaseForServer(serverId);
      await privateNetworks.releaseForServer(serverId);
      if (s.hostId) await scheduler.release(s.hostId, s);
      await prisma.server.update({ where: { id: serverId }, data: { driverRef: null, hostId: null, meteredSince: null, privateIp: null } });
    },

    async powerOp(serverId, op, force) {
      const s = await load(serverId);
      if (!s.driverRef) throw nonRetryable('server has no VM');
      const h = hostRef(s);
      if (op === 'start') await wrap(driver.startVm(h, s.driverRef));
      if (op === 'stop') await wrap(driver.stopVm(h, s.driverRef, { force }));
      if (op === 'reboot') await wrap(driver.rebootVm(h, s.driverRef));
    },

    async isRunning(serverId) {
      const s = await load(serverId);
      if (!s.driverRef) return false;
      return (await driver.getVmStatus(hostRef(s), s.driverRef)).power === 'running';
    },

    async syncStatusFromHypervisor(serverId, message) {
      const s = await load(serverId);
      let status: ServerStatus = 'failed';
      if (s.driverRef && s.host) {
        const st = await driver.getVmStatus(s.host.driverRef, s.driverRef).catch(() => ({ power: 'unknown' as const }));
        if (st.power === 'running') status = 'active';
        else if (st.power === 'stopped') status = 'off';
      }
      await prisma.server.update({ where: { id: serverId }, data: { status, statusMessage: message } });
    },

    async resizeVm(serverId, sizeId) {
      const s = await load(serverId);
      const size = await prisma.size.findUniqueOrThrow({ where: { id: sizeId } });
      if (!s.driverRef) throw nonRetryable('server has no VM');
      await wrap(driver.resizeVm(hostRef(s), s.driverRef, size));
      if (s.hostId) {
        await scheduler.release(s.hostId, s);
        await prisma.host.update({ where: { id: s.hostId }, data: { usedVcpu: { increment: size.vcpu }, usedMemoryMb: { increment: size.memoryMb }, usedDiskGb: { increment: size.diskGb } } });
      }
      await prisma.server.update({ where: { id: serverId }, data: { sizeId, vcpu: size.vcpu, memoryMb: size.memoryMb, diskGb: size.diskGb } });
    },

    async deleteVm(serverId) {
      const s = await load(serverId);
      if (!s.driverRef || !s.host) return;
      await wrap(driver.deleteVm(s.host.driverRef, s.driverRef));
      await prisma.server.update({ where: { id: serverId }, data: { driverRef: null } });
    },

    async finalizeDelete(serverId) {
      const s = await load(serverId);
      await ips.releaseForServer(serverId);
      await privateNetworks.releaseForServer(serverId);
      if (s.hostId) await scheduler.release(s.hostId, s);
      await prisma.server.update({ where: { id: serverId }, data: { status: 'deleted', deletedAt: new Date(), hostId: null, meteredSince: null } });
      // Volumes survive their server; the VM is gone so the images are simply free again.
      await prisma.volume.updateMany({ where: { serverId }, data: { serverId: null, device: null, status: 'available' } });
    },

    async createSnapshotRecord(serverId, name, kind = 'manual') {
      const s = await load(serverId);
      const existing = await prisma.snapshot.findFirst({ where: { serverId, name, status: 'pending' } });
      if (existing) return existing.id;
      return (await prisma.snapshot.create({ data: { projectId: s.projectId, serverId, name, kind } })).id;
    },

    async snapshotVm(serverId, snapshotId) {
      const s = await load(serverId);
      if (!s.driverRef) throw nonRetryable('server has no VM');
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      try {
        const r = await wrap(driver.snapshotVm(hostRef(s), s.driverRef, snapshotId));
        await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'available', driverRef: r.snapshotRef, sizeGb: r.sizeGb } });
      } finally {
        clearInterval(heartbeat);
      }
    },

    async rollbackVm(serverId, snapshotId) {
      const s = await load(serverId);
      if (!s.driverRef) throw nonRetryable('server has no VM');
      const snap = await prisma.snapshot.findFirst({ where: { id: snapshotId, serverId, status: 'available' } });
      if (!snap?.driverRef) throw nonRetryable(`snapshot ${snapshotId} is not available for this server`);
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      try {
        await wrap(driver.rollbackVm(hostRef(s), s.driverRef, snap.driverRef));
      } finally {
        clearInterval(heartbeat);
      }
    },

    async failSnapshot(snapshotId, message) {
      await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'failed' } }).catch(() => undefined);
      log.warn(`snapshot ${snapshotId} failed: ${message}`);
    },

    async deleteSnapshotVm(snapshotId) {
      const snap = await prisma.snapshot.findUnique({ where: { id: snapshotId }, include: { server: { include: { host: true } } } });
      if (!snap || snap.status === 'deleted') return;
      if (snap.driverRef && snap.server?.host) await wrap(driver.deleteSnapshot(snap.server.host.driverRef, snap.driverRef));
      await prisma.snapshot.update({ where: { id: snapshotId }, data: { status: 'deleted', deletedAt: new Date() } });
    },

    // ---- block volumes ----

    async volumeCreate(volumeId) {
      const v = await prisma.volume.findUnique({ where: { id: volumeId } });
      if (!v) throw nonRetryable(`volume ${volumeId} no longer exists`);
      if (v.driverRef) return; // retried after the image was already allocated
      // Ceph is shared across the region, so any active host can allocate the image.
      const host = await prisma.host.findFirst({ where: { regionId: v.regionId, status: 'active' }, orderBy: { lastHeartbeatAt: 'desc' } });
      if (!host) throw new Error('no active host in region to allocate the volume');
      const r = await wrap(driver.createVolume(host.driverRef, { volumeId, sizeGb: v.sizeGb }));
      await prisma.volume.update({ where: { id: volumeId }, data: { driverRef: r.volumeRef, status: 'available', statusMessage: null, meteredSince: new Date() } });
    },

    async volumeAttach(volumeId, serverId) {
      const [v, s] = await Promise.all([prisma.volume.findUnique({ where: { id: volumeId } }), load(serverId)]);
      if (!v?.driverRef) throw nonRetryable('volume has no image');
      if (!s.driverRef) throw nonRetryable('server has no VM');
      const r = await wrap(driver.attachVolume(hostRef(s), s.driverRef, v.driverRef, serial(volumeId)));
      await prisma.volume.update({ where: { id: volumeId }, data: { status: 'attached', serverId, device: r.device, statusMessage: null } });
      return r;
    },

    async volumeDetach(volumeId) {
      const v = await prisma.volume.findUnique({ where: { id: volumeId }, include: { server: { include: { host: true } } } });
      if (!v?.driverRef) throw nonRetryable('volume has no image');
      if (v.server?.host && v.server.driverRef) await wrap(driver.detachVolume(v.server.host.driverRef, v.server.driverRef, v.driverRef));
      await prisma.volume.update({ where: { id: volumeId }, data: { status: 'available', serverId: null, device: null, statusMessage: null } });
    },

    async volumeResize(volumeId, sizeGb) {
      const v = await prisma.volume.findUnique({ where: { id: volumeId }, include: { server: { include: { host: true } } } });
      if (!v?.driverRef) throw nonRetryable('volume has no image');
      let host = v.server?.host?.driverRef;
      if (!host) host = (await prisma.host.findFirst({ where: { regionId: v.regionId, status: 'active' } }))?.driverRef;
      if (!host) throw new Error('no active host in region to resize the volume');
      await wrap(driver.resizeVolume(host, v.driverRef, sizeGb, v.server?.driverRef ?? undefined));
      await prisma.volume.update({ where: { id: volumeId }, data: { sizeGb, status: v.serverId ? 'attached' : 'available', statusMessage: null } });
    },

    async volumeDelete(volumeId) {
      const v = await prisma.volume.findUnique({ where: { id: volumeId } });
      if (!v || v.status === 'deleted') return;
      if (v.driverRef) {
        const host = await prisma.host.findFirst({ where: { regionId: v.regionId, status: 'active' } });
        if (host) await wrap(driver.deleteVolume(host.driverRef, v.driverRef));
      }
      await prisma.volume.update({ where: { id: volumeId }, data: { status: 'deleted', deletedAt: new Date(), serverId: null, device: null, meteredSince: null } });
    },

    async setVolumeStatus(volumeId, status, message) {
      await prisma.volume.update({ where: { id: volumeId }, data: { status, statusMessage: message ?? null } }).catch(() => undefined);
    },

    async emitVolume(name, volumeId, payload) {
      const v = await prisma.volume.findUnique({ where: { id: volumeId }, include: { project: { select: { teamId: true } } } });
      await events.emit(name, { volumeId, name: v?.name, status: v?.status, serverId: v?.serverId, sizeGb: v?.sizeGb, ...payload }, { teamId: v?.project.teamId, resource: `volume:${volumeId}` });
    },

    // ---- load balancers ----

    async lbWaitNodes(lbId) {
      // Node VMs are provisioned by their own createServer workflows; wait for all of them.
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.loadBalancerNode.findMany({ where: { loadBalancerId: lbId }, include: { server: { select: { status: true, statusMessage: true, name: true } } } });
        if (!nodes.length) throw nonRetryable('load balancer has no nodes');
        const failed = nodes.find((n) => n.server.status === 'failed');
        if (failed) throw nonRetryable(`node ${failed.server.name} failed: ${failed.server.statusMessage ?? 'unknown error'}`);
        if (nodes.every((n) => n.server.status === 'active')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not become active in 15 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async lbPushConfig(lbId) {
      return wrap(lbs.pushConfig(lbId));
    },

    async lbSetStatus(lbId, status, message) {
      const data: Record<string, unknown> = { status, statusMessage: message ?? null };
      if (status === 'active') data.meteredSince = (await prisma.loadBalancer.findUnique({ where: { id: lbId }, select: { meteredSince: true } }))?.meteredSince ?? new Date();
      await prisma.loadBalancer.update({ where: { id: lbId }, data }).catch(() => undefined);
    },

    async lbDeleteNodes(lbId) {
      const nodes = await prisma.loadBalancerNode.findMany({ where: { loadBalancerId: lbId }, include: { server: true } });
      for (const n of nodes) {
        if (['deleted', 'deleting'].includes(n.server.status)) continue;
        const action = await prisma.serverAction.create({ data: { serverId: n.serverId, type: 'delete', requestedBy: 'system:lb' } });
        await prisma.server.update({ where: { id: n.serverId }, data: { status: 'deleting' } });
        await temporal.start('deleteServer', [{ serverId: n.serverId, actionId: action.id }], `deleteServer-${action.id}`);
      }
    },

    async lbWaitNodesGone(lbId) {
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.loadBalancerNode.findMany({ where: { loadBalancerId: lbId }, include: { server: { select: { status: true } } } });
        if (nodes.every((n) => n.server.status === 'deleted')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not delete in 15 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async lbFinalizeDelete(lbId) {
      const lb = await prisma.loadBalancer.findUnique({ where: { id: lbId } });
      if (!lb) return;
      if (lb.publicIpId) await ips.release(lb.publicIpId).catch(() => undefined);
      if (lb.firewallId) await prisma.firewall.delete({ where: { id: lb.firewallId } }).catch(() => undefined);
      await prisma.loadBalancer.update({ where: { id: lbId }, data: { status: 'deleted', deletedAt: new Date(), publicIpId: null, firewallId: null, meteredSince: null } });
    },

    async emitLb(name, lbId, payload) {
      const lb = await prisma.loadBalancer.findUnique({ where: { id: lbId }, include: { project: { select: { teamId: true } }, publicIp: { select: { address: true } } } });
      await events.emit(name, { loadBalancerId: lbId, name: lb?.name, status: lb?.status, ip: lb?.publicIp?.address, ...payload }, { teamId: lb?.project.teamId, resource: `load_balancer:${lbId}` });
    },

    // ---- managed databases (same shape as load balancers) ----

    async dbWaitNodes(clusterId) {
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.dbNode.findMany({ where: { clusterId }, include: { server: { select: { status: true, statusMessage: true, name: true } } } });
        if (!nodes.length) throw nonRetryable('database has no nodes');
        const failed = nodes.find((n) => n.server.status === 'failed');
        if (failed) throw nonRetryable(`node ${failed.server.name} failed: ${failed.server.statusMessage ?? 'unknown error'}`);
        if (nodes.every((n) => n.server.status === 'active')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not become active in 15 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async dbPushConfig(clusterId) {
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      try {
        return await wrap(dbs.pushConfig(clusterId));
      } finally {
        clearInterval(heartbeat);
      }
    },

    async dbWaitApplied(clusterId, timeoutMinutes) {
      await wrap(dbs.waitApplied(clusterId, timeoutMinutes * 60_000, () => Context.current().heartbeat()));
    },

    async dbRestore(clusterId, backupId) {
      await wrap(dbs.runRestore(clusterId, backupId, () => Context.current().heartbeat()));
    },

    async dbSetStatus(clusterId, status, message) {
      const data: Record<string, unknown> = { status, statusMessage: message ?? null };
      if (status === 'active') data.meteredSince = (await prisma.dbCluster.findUnique({ where: { id: clusterId }, select: { meteredSince: true } }))?.meteredSince ?? new Date();
      await prisma.dbCluster.update({ where: { id: clusterId }, data }).catch(() => undefined);
    },

    async dbDeleteNodes(clusterId) {
      const nodes = await prisma.dbNode.findMany({ where: { clusterId }, include: { server: true } });
      for (const n of nodes) {
        if (['deleted', 'deleting'].includes(n.server.status)) continue;
        const action = await prisma.serverAction.create({ data: { serverId: n.serverId, type: 'delete', requestedBy: 'system:db' } });
        await prisma.server.update({ where: { id: n.serverId }, data: { status: 'deleting' } });
        await temporal.start('deleteServer', [{ serverId: n.serverId, actionId: action.id }], `deleteServer-${action.id}`);
      }
    },

    async dbWaitNodesGone(clusterId) {
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.dbNode.findMany({ where: { clusterId }, include: { server: { select: { status: true } } } });
        if (nodes.every((n) => n.server.status === 'deleted')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not delete in 15 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async dbFinalizeDelete(clusterId) {
      const c = await prisma.dbCluster.findUnique({ where: { id: clusterId } });
      if (!c) return;
      if (c.publicIpId) await ips.release(c.publicIpId).catch(() => undefined);
      if (c.firewallId) await prisma.firewall.delete({ where: { id: c.firewallId } }).catch(() => undefined);
      // Backups go with the cluster: empty and remove the platform bucket and its key.
      const removed = await dbs.purgeBackups(clusterId);
      log.log(`database ${clusterId}: removed ${removed} backup objects`);
      await prisma.dbCluster.update({ where: { id: clusterId }, data: { status: 'deleted', deletedAt: new Date(), publicIpId: null, firewallId: null, meteredSince: null, adminPassword: '', backupBucket: null, backupAccessKey: null, backupSecretKey: null } });
    },

    // ---- managed kubernetes (same shape as databases) ----

    async k8sWaitNodes(clusterId) {
      const deadline = Date.now() + 20 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.kubeNode.findMany({ where: { clusterId }, include: { server: { select: { status: true, statusMessage: true, name: true } } } });
        if (!nodes.length) throw nonRetryable('cluster has no nodes');
        const failed = nodes.find((n) => n.server.status === 'failed');
        if (failed) throw nonRetryable(`node ${failed.server.name} failed: ${failed.server.statusMessage ?? 'unknown error'}`);
        if (nodes.every((n) => n.server.status === 'active')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not become active in 20 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async k8sPushConfig(clusterId) {
      const heartbeat = setInterval(() => Context.current().heartbeat(), 20_000);
      try {
        return await wrap(k8s.pushConfig(clusterId));
      } finally {
        clearInterval(heartbeat);
      }
    },

    /** Node 0 initialises the cluster on its first config; keep pushing until every node has joined. */
    async k8sWaitBootstrap(clusterId) {
      const deadline = Date.now() + 30 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const r = await wrap(k8s.pushConfig(clusterId));
        const c = await prisma.kubeCluster.findUnique({ where: { id: clusterId }, select: { kubeconfig: true, configVersion: true } });
        if (r.applied === r.nodes && c?.kubeconfig) return;
        if (Date.now() > deadline) throw nonRetryable(`only ${r.applied} of ${r.nodes} nodes joined in 30 minutes`);
        await new Promise((res) => setTimeout(res, 15_000));
      }
    },

    async k8sSetStatus(clusterId, status, message) {
      const data: Record<string, unknown> = { status, statusMessage: message ?? null };
      if (status === 'active') data.meteredSince = (await prisma.kubeCluster.findUnique({ where: { id: clusterId }, select: { meteredSince: true } }))?.meteredSince ?? new Date();
      await prisma.kubeCluster.update({ where: { id: clusterId }, data }).catch(() => undefined);
    },

    /** Load balancers and volumes the cloud controller made go with the cluster. */
    async k8sDeleteCloud(clusterId) {
      const c = await prisma.kubeCluster.findUnique({ where: { id: clusterId } });
      if (!c) return;
      const state = (c.cloudState ?? {}) as { services?: Record<string, { lbId: string }>; volumes?: Record<string, { volumeId: string }> };
      for (const s of Object.values(state.services ?? {})) {
        const lb = await prisma.loadBalancer.findUnique({ where: { id: s.lbId } });
        if (lb && !['deleting', 'deleted'].includes(lb.status)) {
          await prisma.loadBalancer.update({ where: { id: s.lbId }, data: { status: 'deleting' } });
          await temporal.start('deleteLoadBalancer', [{ lbId: s.lbId }], `deleteLoadBalancer-${s.lbId}`);
        }
      }
      for (const v of Object.values(state.volumes ?? {})) {
        const vol = await prisma.volume.findUnique({ where: { id: v.volumeId } });
        if (vol && !['deleting', 'deleted'].includes(vol.status)) {
          // Node servers are deleted next, which detaches; the volume itself is removed after that.
          await prisma.volume.update({ where: { id: v.volumeId }, data: { statusMessage: 'cluster deleted' } });
        }
      }
    },

    async k8sDeleteNodes(clusterId) {
      const nodes = await prisma.kubeNode.findMany({ where: { clusterId }, include: { server: true } });
      for (const n of nodes) {
        if (['deleted', 'deleting'].includes(n.server.status)) continue;
        const action = await prisma.serverAction.create({ data: { serverId: n.serverId, type: 'delete', requestedBy: 'system:k8s' } });
        await prisma.server.update({ where: { id: n.serverId }, data: { status: 'deleting' } });
        await temporal.start('deleteServer', [{ serverId: n.serverId, actionId: action.id }], `deleteServer-${action.id}`);
      }
    },

    async k8sWaitNodesGone(clusterId) {
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const nodes = await prisma.kubeNode.findMany({ where: { clusterId }, include: { server: { select: { status: true } } } });
        if (nodes.every((n) => n.server.status === 'deleted')) return;
        if (Date.now() > deadline) throw nonRetryable('nodes did not delete in 15 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async k8sFinalizeDelete(clusterId) {
      const c = await prisma.kubeCluster.findUnique({ where: { id: clusterId } });
      if (!c) return;
      const state = (c.cloudState ?? {}) as { volumes?: Record<string, { volumeId: string }> };
      for (const v of Object.values(state.volumes ?? {})) {
        const vol = await prisma.volume.findUnique({ where: { id: v.volumeId } });
        if (vol && vol.status === 'available') {
          await prisma.volume.update({ where: { id: v.volumeId }, data: { status: 'deleting' } });
          await temporal.start('deleteVolume', [{ volumeId: v.volumeId }], `deleteVolume-${v.volumeId}`);
        }
      }
      if (c.publicIpId) await ips.release(c.publicIpId).catch(() => undefined);
      if (c.firewallId) await prisma.firewall.delete({ where: { id: c.firewallId } }).catch(() => undefined);
      await k8s.purgeBackups(clusterId).catch((e) => log.warn(`etcd snapshot bucket for ${clusterId}: ${(e as Error).message}`));
      await prisma.kubeCluster.update({ where: { id: clusterId }, data: { status: 'deleted', deletedAt: new Date(), publicIpId: null, firewallId: null, meteredSince: null, kubeconfig: null, certKey: '', joinToken: '' } });
    },

    async emitK8s(name, clusterId, payload) {
      const c = await prisma.kubeCluster.findUnique({ where: { id: clusterId }, include: { project: { select: { teamId: true } }, publicIp: { select: { address: true } } } });
      await events.emit(name, { clusterId, name: c?.name, version: c?.version, status: c?.status, host: c?.publicIp?.address, ...payload }, { teamId: c?.project.teamId, resource: `kubernetes:${clusterId}` });
    },

    // ---- app platform ----

    async appPlace(appId) {
      return wrap(apps.placeApp(appId));
    },

    async appWaitHost(hostId) {
      const deadline = Date.now() + 20 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const h = await prisma.appHost.findUnique({ where: { id: hostId }, include: { server: { select: { id: true, name: true, status: true, statusMessage: true, privateIp: true, publicIps: { select: { address: true } } } } } });
        if (!h) throw nonRetryable('app host vanished');
        if (h.status === 'failed') throw nonRetryable('app host failed');
        // The VM being up is not enough: the agent must report Docker and Caddy running.
        if (h.server.status === 'active' && hostReady(await apps.hostStatus(h).catch(() => null))) {
          await prisma.appHost.update({ where: { id: hostId }, data: { status: 'active', readyAt: new Date() } });
          return;
        }
        if (h.server.status === 'failed') {
          await prisma.appHost.update({ where: { id: hostId }, data: { status: 'failed' } });
          throw nonRetryable(`app host failed: ${h.server.statusMessage ?? 'unknown error'}`);
        }
        if (Date.now() > deadline) throw nonRetryable('app host did not report Docker and Caddy running in 20 minutes');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },

    async appPushHost(hostId) {
      await wrap(apps.pushHost(hostId));
    },

    /** Poll the host until the deploy is live or failed; the minute job also folds results in. */
    async appWaitDeploy(appId, deployId) {
      const deadline = Date.now() + 25 * 60_000;
      for (;;) {
        Context.current().heartbeat();
        const a = await prisma.platformApp.findUnique({ where: { id: appId }, include: { host: { include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } } } }, deploys: { where: { id: deployId } } } });
        if (!a || !a.host) throw nonRetryable('app or host vanished');
        const st = await apps.hostStatus(a.host).catch(() => null);
        if (st) await apps.applyReport({ id: a.id, status: a.status, deploys: a.deploys }, st.apps[a.id]);
        const d = await prisma.appDeploy.findUnique({ where: { id: deployId } });
        if (d?.status === 'live' || d?.status === 'failed') return d.status;
        if (Date.now() > deadline) throw nonRetryable('build did not finish in 25 minutes');
        await new Promise((r) => setTimeout(r, 5000));
      }
    },

    async appSetStatus(appId, status, message) {
      const data: Record<string, unknown> = { status, statusMessage: message ?? null };
      if (status === 'live') data.meteredSince = (await prisma.platformApp.findUnique({ where: { id: appId }, select: { meteredSince: true } }))?.meteredSince ?? new Date();
      await prisma.platformApp.update({ where: { id: appId }, data }).catch(() => undefined);
    },

    async appUpsertDns(appId) {
      await apps.upsertDns(appId).catch((e) => log.warn(`dns for app ${appId}: ${(e as Error).message}`));
    },

    async appFinalizeDelete(appId) {
      const a = await prisma.platformApp.findUnique({ where: { id: appId } });
      if (!a) return;
      await prisma.platformApp.update({ where: { id: appId }, data: { status: 'deleted', deletedAt: new Date(), meteredSince: null, gitToken: null, envVars: {} } });
      if (a.hostId) await apps.pushHost(a.hostId).catch((e) => log.warn(`delete push for ${appId}: ${(e as Error).message}`));
      await apps.removeDns(a.slug).catch(() => undefined);
    },

    async emitApp(name, appId, payload) {
      await apps.emit(name, appId, payload);
    },

    async emitDb(name, clusterId, payload) {
      const c = await prisma.dbCluster.findUnique({ where: { id: clusterId }, include: { project: { select: { teamId: true } }, publicIp: { select: { address: true } } } });
      await events.emit(name, { databaseId: clusterId, name: c?.name, engine: c?.engine, status: c?.status, host: c?.publicIp?.address, ...payload }, { teamId: c?.project.teamId, resource: `database:${clusterId}` });
    },

    async completeAction(actionId) {
      await prisma.serverAction.update({ where: { id: actionId }, data: { status: 'completed', finishedAt: new Date() } });
    },

    async failAction(actionId, message) {
      await prisma.serverAction.update({ where: { id: actionId }, data: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() } });
    },

    async emit(name, serverId, payload) {
      const s = await prisma.server.findUnique({ where: { id: serverId }, include: { project: { select: { teamId: true } } } });
      await events.emit(name, { serverId, name: s?.name, status: s?.status, ...payload }, { teamId: s?.project.teamId, resource: `server:${serverId}` });
    },
  };
}

/** SCSI serial the guest sees in /dev/disk/by-id; QEMU allows 20 characters. */
function serial(volumeId: string) {
  return volumeId.replace(/[^a-zA-Z0-9]/g, '').slice(-20);
}

function nonRetryable(message: string) {
  return ApplicationFailure.create({ message, type: 'NonRetryable', nonRetryable: true });
}
