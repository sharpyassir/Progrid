# prgd host agent

A single static Go binary that runs on every Proxmox VE node.

```
control plane ──NATS request──▶ prgd.host.<hostId>.jobs ──▶ agent ──▶ local PVE API
control plane ◀──NATS publish── prgd.host.<hostId>.heartbeat (every minute)
control plane ◀──NATS publish── prgd.usage (usage.v1, per resource per minute)
```

- Jobs are request/reply; the agent de-duplicates on job id for one hour.
- Every result carries `retryable`, which drives the Temporal retry policy upstream.
- Boot completion is detected by the QEMU guest agent answering `ping` — golden images
  enable `qemu-guest-agent` as the last cloud-init step.
- cloud-init user-data is written to `/var/lib/vz/snippets/` and referenced via `cicustom`.
- Firewalls are applied on the host (`/qemu/<vmid>/firewall`), default policy DROP in.
- VMs are tagged `prgd;server-<id>;project-<id>` so usage is attributable offline.

Build: `go build -ldflags "-X main.version=$(git describe --tags --always)" -o host-agent .`

Node prerequisites (Ansible role to come): PVE API token with `PVEVMAdmin` + `PVEDatastoreUser` on the Ceph storage, `snippets` content enabled on `local`, the shared bridge `customers`, and for per project VNets (`PRIVATE_NETWORK_MODE=sdn_vnet`) a VXLAN zone on every node plus the `PVESDNAdmin` role on `/sdn` for the token (see docs/hosting.md), `vmbr0` with the public block routed.

## Testing without a Proxmox node

`go test ./...` runs the agent end to end on a laptop or in CI. The harness in
`internal/agent/agent_test.go` starts an embedded NATS server, a simulated Proxmox API
(`internal/pvesim`) and one agent, then sends jobs over NATS exactly as the control plane
does and checks the replies and the simulated VM state.

What the simulator answers: next id, clone, config, resize, start, stop, shutdown, reboot,
delete, status, guest agent ping (after a boot delay) and network-get-interfaces, snapshot
create and delete, firewall options, rules and IP sets, SDN zones, VNets (pending until applied)
and `PUT /cluster/sdn`, node and storage status, VM list, and task polling by UPID. A start
fails when a NIC's bridge is neither a plain bridge nor an applied VNet. It uses the
same JSON envelope and the same error texts as Proxmox, including `does not exist` on a
missing VM. `FailNext(op, n)` injects faults to test cleanup and retry classification.

Covered: create with cloud-init snippet, static private address (or DHCP without one), public
network and attribution tags; net0 on a project VNet; VNet creation, apply and conflicts; the IP
filter and its IP sets, including floating addresses and NICs left on DHCP; guest addresses after
boot and in heartbeats; wait for boot;
power actions; snapshot round trip; firewall replace with port range translation; resize and
the shrink refusal; delete idempotency; error codes (`bad_ref`, `unknown_job`,
`bad_image_ref`, `not_implemented`, `proxmox_500`, `job_failed`); duplicate job ids; the
heartbeat and per minute usage events; token rejection.

Not covered, and only a real node can show: token permissions, Ceph timing, SDN reload
across nodes and VXLAN traffic between them, ipfilter enforcement, cloud-init inside the guest. Run the same jobs against the first node with
`PRGD_SNIPPETS_DIR` unset before calling the data plane done.
