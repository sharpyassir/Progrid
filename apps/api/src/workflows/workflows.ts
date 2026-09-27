/**
 * Temporal workflow definitions. This file is bundled into the workflow sandbox: it may
 * only import from `@temporalio/workflow` and pure modules. All I/O lives in activities.
 * See docs/adr/0003-temporal-workflows.md.
 */
import { ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type { Activities } from './activities';

const act = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '2s', backoffCoefficient: 2, maximumInterval: '1 minute', maximumAttempts: 5, nonRetryableErrorTypes: ['NonRetryable'] },
});

const slow = proxyActivities<Activities>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '2 minutes', maximumAttempts: 3, nonRetryableErrorTypes: ['NonRetryable'] },
});

export interface CreateServerInput {
  serverId: string;
  actionId: string;
  avoid: string[];
}

/**
 * POST /v1/servers → this. ~30–60 s on real hardware. Any failure after placement
 * compensates (VM deleted, IP + capacity released) and marks the server `failed`;
 * metering starts only once the VM is running, so a broken server is never billed.
 */
export async function createServer(input: CreateServerInput): Promise<void> {
  const { serverId, actionId } = input;
  let placed = false;
  try {
    await act.setStatus(serverId, 'provisioning');
    await act.placeServer(serverId, input.avoid);
    placed = true;
    await act.reserveIp(serverId);
    await slow.createVm(serverId);
    await slow.waitForBoot(serverId);
    await act.applyFirewall(serverId);
    await act.startMeter(serverId);
    await act.setStatus(serverId, 'active');
    await act.completeAction(actionId);
    await act.emit('server.active', serverId, {});
  } catch (err) {
    const message = describe(err);
    if (placed) await act.compensateCreate(serverId);
    await act.setStatus(serverId, 'failed', message);
    await act.failAction(actionId, message);
    await act.emit('server.failed', serverId, { error: message });
    throw ApplicationFailure.nonRetryable(`create-server ${serverId} failed: ${message}`);
  }
}

export interface PowerInput {
  serverId: string;
  actionId: string;
  op: 'start' | 'stop' | 'reboot';
  force?: boolean;
}

export async function powerServer(input: PowerInput): Promise<void> {
  const { serverId, actionId, op } = input;
  try {
    await act.powerOp(serverId, op, !!input.force);
    await act.setStatus(serverId, op === 'stop' ? 'off' : 'active');
    await act.completeAction(actionId);
  } catch (err) {
    const message = describe(err);
    // Power ops are non-destructive: fall back to what the hypervisor says.
    await act.syncStatusFromHypervisor(serverId, message);
    await act.failAction(actionId, message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export interface ResizeInput {
  serverId: string;
  actionId: string;
  sizeId: string;
}

export async function resizeServer(input: ResizeInput): Promise<void> {
  const { serverId, actionId, sizeId } = input;
  try {
    const wasRunning = await act.isRunning(serverId);
    if (wasRunning) await act.powerOp(serverId, 'stop', false);
    await slow.resizeVm(serverId, sizeId);
    if (wasRunning) await act.powerOp(serverId, 'start', false);
    await act.setStatus(serverId, wasRunning ? 'active' : 'off');
    await act.completeAction(actionId);
    await act.emit('server.resized', serverId, { size: sizeId });
  } catch (err) {
    const message = describe(err);
    await act.syncStatusFromHypervisor(serverId, message);
    await act.failAction(actionId, message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export interface RebuildInput {
  serverId: string;
  actionId: string;
  imageId: string;
}

/** Rebuild = delete VM, create from the new image on the same host, keep IPs and firewalls. */
export async function rebuildServer(input: RebuildInput): Promise<void> {
  const { serverId, actionId, imageId } = input;
  try {
    await act.deleteVm(serverId);
    await act.setImage(serverId, imageId);
    await slow.createVm(serverId);
    await slow.waitForBoot(serverId);
    await act.applyFirewall(serverId);
    await act.setStatus(serverId, 'active');
    await act.completeAction(actionId);
    await act.emit('server.rebuilt', serverId, { image: imageId });
  } catch (err) {
    const message = describe(err);
    await act.setStatus(serverId, 'failed', message);
    await act.failAction(actionId, message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export interface SnapshotInput {
  serverId: string;
  actionId: string;
  name: string;
  kind?: 'manual' | 'backup';
}

export async function snapshotServer(input: SnapshotInput): Promise<void> {
  const { serverId, actionId, name, kind } = input;
  const snapshotId = await act.createSnapshotRecord(serverId, name, kind);
  try {
    await slow.snapshotVm(serverId, snapshotId);
    await act.completeAction(actionId);
    await act.emit('snapshot.completed', serverId, { snapshotId, name });
  } catch (err) {
    const message = describe(err);
    await act.failSnapshot(snapshotId, message);
    await act.failAction(actionId, message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export interface DeleteInput {
  serverId: string;
  actionId: string;
}

/** Deleting is best-effort idempotent: a VM that is already gone counts as deleted. */
export async function deleteServer(input: DeleteInput): Promise<void> {
  const { serverId, actionId } = input;
  try {
    await act.deleteVm(serverId);
    await act.finalizeDelete(serverId);
    await act.completeAction(actionId);
    await act.emit('server.deleted', serverId, {});
  } catch (err) {
    const message = describe(err);
    await act.setStatus(serverId, 'failed', `delete failed: ${message}`);
    await act.failAction(actionId, message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deleteSnapshot(input: { snapshotId: string }): Promise<void> {
  await slow.deleteSnapshotVm(input.snapshotId);
}

// ---- block volumes ----
// Each workflow owns one transition. On failure the volume goes back to a stable status with
// the message so the customer sees what happened and can retry.

export async function createVolume(input: { volumeId: string; serverId?: string }): Promise<void> {
  const { volumeId, serverId } = input;
  try {
    await slow.volumeCreate(volumeId);
    await act.emitVolume('volume.created', volumeId, {});
  } catch (err) {
    const message = describe(err);
    await act.setVolumeStatus(volumeId, 'failed', `create failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
  if (serverId) {
    await act.setVolumeStatus(volumeId, 'attaching');
    await attachVolume({ volumeId, serverId });
  }
}

export async function attachVolume(input: { volumeId: string; serverId: string }): Promise<void> {
  const { volumeId, serverId } = input;
  try {
    const r = await act.volumeAttach(volumeId, serverId);
    await act.emitVolume('volume.attached', volumeId, { serverId, device: r.device });
  } catch (err) {
    const message = describe(err);
    await act.setVolumeStatus(volumeId, 'available', `attach failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function detachVolume(input: { volumeId: string }): Promise<void> {
  const { volumeId } = input;
  try {
    await act.volumeDetach(volumeId);
    await act.emitVolume('volume.detached', volumeId, {});
  } catch (err) {
    const message = describe(err);
    await act.setVolumeStatus(volumeId, 'attached', `detach failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function resizeVolume(input: { volumeId: string; sizeGb: number; wasAttached: boolean }): Promise<void> {
  const { volumeId, sizeGb, wasAttached } = input;
  try {
    await slow.volumeResize(volumeId, sizeGb);
    await act.emitVolume('volume.resized', volumeId, { sizeGb });
  } catch (err) {
    const message = describe(err);
    await act.setVolumeStatus(volumeId, wasAttached ? 'attached' : 'available', `resize failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deleteVolume(input: { volumeId: string }): Promise<void> {
  const { volumeId } = input;
  try {
    await slow.volumeDelete(volumeId);
    await act.emitVolume('volume.deleted', volumeId, {});
  } catch (err) {
    const message = describe(err);
    await act.setVolumeStatus(volumeId, 'available', `delete failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

// ---- load balancers ----

export async function createLoadBalancer(input: { lbId: string }): Promise<void> {
  const { lbId } = input;
  try {
    await slow.lbWaitNodes(lbId);
    await act.lbPushConfig(lbId);
    await act.lbSetStatus(lbId, 'active');
    await act.emitLb('load_balancer.created', lbId, {});
  } catch (err) {
    const message = describe(err);
    await act.lbSetStatus(lbId, 'failed', `create failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function updateLoadBalancer(input: { lbId: string }): Promise<void> {
  const { lbId } = input;
  try {
    const r = await act.lbPushConfig(lbId);
    // With nodes still unreachable the minute job keeps retrying; the row stays 'updating' until every node runs the version.
    if (r.applied === r.nodes) await act.lbSetStatus(lbId, 'active');
    await act.emitLb('load_balancer.updated', lbId, { applied: r.applied, nodes: r.nodes });
  } catch (err) {
    const message = describe(err);
    await act.lbSetStatus(lbId, 'active', `update failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deleteLoadBalancer(input: { lbId: string }): Promise<void> {
  const { lbId } = input;
  try {
    await act.lbDeleteNodes(lbId);
    await slow.lbWaitNodesGone(lbId);
    await act.lbFinalizeDelete(lbId);
    await act.emitLb('load_balancer.deleted', lbId, {});
  } catch (err) {
    const message = describe(err);
    await act.lbSetStatus(lbId, 'failed', `delete failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

// ---- managed databases ----

export async function createDatabase(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    await slow.dbWaitNodes(clusterId);
    await slow.dbPushConfig(clusterId);
    await act.dbSetStatus(clusterId, 'active');
    await act.emitDb('database.created', clusterId, {});
  } catch (err) {
    const message = describe(err);
    await act.dbSetStatus(clusterId, 'failed', `create failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function updateDatabase(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    const r = await slow.dbPushConfig(clusterId);
    if (r.applied === r.nodes) await act.dbSetStatus(clusterId, 'active');
    await act.emitDb('database.updated', clusterId, { applied: r.applied, nodes: r.nodes });
  } catch (err) {
    const message = describe(err);
    await act.dbSetStatus(clusterId, 'active', `update failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deleteDatabase(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    await act.dbDeleteNodes(clusterId);
    await slow.dbWaitNodesGone(clusterId);
    await act.dbFinalizeDelete(clusterId);
    await act.emitDb('database.deleted', clusterId, {});
  } catch (err) {
    const message = describe(err);
    await act.dbSetStatus(clusterId, 'failed', `delete failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'cause' in err && (err as { cause?: { message?: string } }).cause?.message) {
    return (err as { cause: { message: string } }).cause.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---- managed kubernetes ----

export async function createKubernetes(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    await slow.k8sWaitNodes(clusterId);
    await slow.k8sWaitBootstrap(clusterId);
    await act.k8sSetStatus(clusterId, 'active');
    await act.emitK8s('kubernetes.created', clusterId, {});
  } catch (err) {
    const message = describe(err);
    await act.k8sSetStatus(clusterId, 'failed', `create failed: ${message}`);
    await act.emitK8s('kubernetes.failed', clusterId, { message });
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function updateKubernetes(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    await slow.k8sWaitNodes(clusterId);
    const r = await slow.k8sPushConfig(clusterId);
    if (r.applied === r.nodes) await act.k8sSetStatus(clusterId, 'active');
    await act.emitK8s('kubernetes.updated', clusterId, { applied: r.applied, nodes: r.nodes });
  } catch (err) {
    const message = describe(err);
    await act.k8sSetStatus(clusterId, 'active', `update failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deleteKubernetes(input: { clusterId: string }): Promise<void> {
  const { clusterId } = input;
  try {
    await act.k8sDeleteCloud(clusterId);
    await act.k8sDeleteNodes(clusterId);
    await slow.k8sWaitNodesGone(clusterId);
    await act.k8sFinalizeDelete(clusterId);
    await act.emitK8s('kubernetes.deleted', clusterId, {});
  } catch (err) {
    const message = describe(err);
    await act.k8sSetStatus(clusterId, 'failed', `delete failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

// ---- app platform ----

export async function createPlatformApp(input: { appId: string; deployId: string }): Promise<void> {
  const { appId, deployId } = input;
  try {
    const hostId = await act.appPlace(appId);
    await slow.appWaitHost(hostId);
    await act.appUpsertDns(appId);
    await act.appSetStatus(appId, 'building');
    await act.appPushHost(hostId);
    const result = await slow.appWaitDeploy(appId, deployId);
    if (result === 'failed') {
      await act.appSetStatus(appId, 'failed', 'first build failed; see the build log');
      await act.emitApp('app.deploy_failed', appId, { deployId });
      return;
    }
    await act.appSetStatus(appId, 'live');
    await act.emitApp('app.created', appId, { deployId });
  } catch (err) {
    const message = describe(err);
    await act.appSetStatus(appId, 'failed', `create failed: ${message}`);
    await act.emitApp('app.deploy_failed', appId, { deployId, message });
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deployPlatformApp(input: { appId: string; deployId: string }): Promise<void> {
  const { appId, deployId } = input;
  try {
    const hostId = await act.appPlace(appId);
    await slow.appWaitHost(hostId);
    await act.appUpsertDns(appId);
    await act.appPushHost(hostId);
    await slow.appWaitDeploy(appId, deployId);
  } catch (err) {
    const message = describe(err);
    await act.appSetStatus(appId, 'failed', `deploy failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}

export async function deletePlatformApp(input: { appId: string }): Promise<void> {
  const { appId } = input;
  try {
    await act.appFinalizeDelete(appId);
    await act.emitApp('app.deleted', appId, {});
  } catch (err) {
    const message = describe(err);
    await act.appSetStatus(appId, 'failed', `delete failed: ${message}`);
    throw ApplicationFailure.nonRetryable(message);
  }
}
