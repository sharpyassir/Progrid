# ADR 0002 — All hypervisor access goes through `HypervisorDriver`

**Status**: accepted · **Date**: 2026-09-25

## Context

Proxmox VE is the first engine; CloudStack, OpenStack or bare KVM are possible later.
The product must not depend on Proxmox concepts (VMIDs, nodes, storages) anywhere
outside the driver.

## Decision

`apps/api/src/drivers/hypervisor.driver.ts` defines the interface the workflows use:

```
createVm(spec) · startVm · stopVm · rebootVm · deleteVm · resizeVm
snapshotVm · restoreSnapshot · getVmStatus · attachPublicIp · applyFirewall
```

Implementations:

- `ProxmoxDriver` — talks to the host agent over NATS (`prgd.host.<hostId>.jobs`);
  the agent calls the Proxmox REST API locally. The control plane never calls Proxmox
  directly, so the data plane keeps working if the control plane is down.
- `FakeDriver` — in-memory, used for local dev and tests. Provisions "VMs" in ~2 s.

Selected by `HYPERVISOR_DRIVER` env var.

Opaque driver handles (`Server.driverRef`, `Host.driverRef`) are JSON strings that only
the driver interprets.

## Consequences

- Workflows and modules are hypervisor-agnostic and fully testable without hardware.
- Adding OpenStack = one new driver + a host-agent variant.
