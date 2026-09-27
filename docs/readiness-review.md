# Technical readiness review

Date: 27 September 2026. Scope: everything in this repository, read against the hardware plan
(Hetzner Falkenstein first, Saudi hosts later). The question was simple: what do we still have
to build before a real customer can pay for a real server.

Short answer: the control plane, console, website, CLI, SDKs, billing math and ticketing are in
good shape and have been exercised end to end with the fake driver. Nothing has ever run against
real Proxmox, real Ceph, real PowerDNS, real Moyasar or real mail. The gaps below are ranked by
what blocks money first. Items marked "fixed" were corrected in the same commit as this document.

## Status by layer

| Layer | State | Verdict |
|---|---|---|
| Website, docs, legal pages, brand | Complete | Ship |
| Console and API (accounts, tokens, approvals, projects) | Complete, tested with fake driver | Ship, with the security items below |
| Billing math, price book, VAT, invoices PDF | Complete | Ship after the invoicing fixes below |
| Payments (Moyasar) | Written, never run against Moyasar | Test on a real merchant account |
| ZATCA e-invoicing | Not built, only a flag on the invoice | Must build or contract before the first SAR invoice |
| Support tickets and email intake | Complete, tested | Ship |
| Compute on Proxmox (host agent, workflows) | Written, tested against a simulator only | First real node test will find bugs; list below |
| Networking (public IPs, firewall, private network) | Public IP, firewall and per project private networks written (static addresses, SDN VNets, IP filter), tested against the simulator; IPv6 missing | Test SDN on a real cluster |
| Volumes, object storage, DNS | Written against Ceph RBD, RGW and PowerDNS; never run on real ones | Test on real cluster |
| Managed databases, Kubernetes, App Platform | Written end to end and run in the integration suite against simulated agents; agents never booted on a real VM | Expect a hardening pass of one to two weeks each |
| Control plane hosting (compose, Ansible) | Single host, working for a demo | Not fit for paying customers as is |
| Observability, backups, DR | Minimal | Build before charging |

## A. Blocks taking money (build first)

1. **ZATCA Phase 2 e-invoicing.** The invoice carries an `eInvoiceType: 'zatca'` flag and nothing
   else. There is no UBL XML, QR code, cryptographic stamp, hash chain, CSID onboarding or
   clearance call. The invoice PDF is English only, the buyer VAT number cannot be entered
   anywhere, and the seller VAT number is optional in config. The website says every invoice is a
   ZATCA e-invoice. Options: integrate a Saudi e-invoicing provider through an `EInvoiceProvider`
   interface (fastest), or build the UBL and signing ourselves (slow). Also add Arabic to the PDF,
   a tax profile on the team (VAT number, address), and simplified versus standard invoice types.
2. **Payment safety.** Fixed: the Ansible env template did not set the payment provider, so a
   cluster deployed by the playbook would run the fake provider and hand out free credit. It now
   sets Moyasar, the public API URL, company details, DNS, object storage and support settings.
   Still to do: run the Moyasar flow on a real merchant account (callback method, mada and Apple
   Pay, USD support), reject payments whose amount or currency differ from the invoice, and stop a
   second payment attempt on an invoice that already has one pending.
3. **Invoicing must be atomic.** Invoice numbers are count plus one outside a transaction, credit
   consumption and invoice creation are separate writes, there is no unique index on team and
   period, and the job lock fails open when Redis is down. ZATCA requires gapless numbering, so
   this needs a sequence, a unique constraint and one transaction per invoice.
4. **Nobody has to pay.** A verified email is enough to run unlimited postpaid resources. There is
   no card on file, no auto charge, no dunning, and suspension does not stop anything: the
   suspend event has no subscriber, suspended servers keep running and stop being billed, and
   databases, Kubernetes, apps and load balancers skip the suspension check. Build: a prepaid or
   card on file requirement for new accounts, overdue reminders, automatic suspension that powers
   VMs off and blocks tokens, and a KYC step (phone or Nafath) before postpaid.
5. **Refunds and credit notes.** The refund policy promises card refunds and credit notes. There
   is no Moyasar refund call, no credit note, no void, and no way to record a bank transfer.

## B. Blocks the first real server (build second)

6. **Host provisioning does not exist.** Nothing installs Proxmox, forms the cluster, sets up Ceph
   (MONs, OSDs, the `vm-disks` pool, keyrings), creates the SDN zone and the `customers` VNet,
   configures `vmbr0` with the routed public block, creates the API token and role, enables
   snippets on local storage, or turns on the datacenter firewall. All of it is assumed. Write an
   Ansible role for a Proxmox node that does these steps, or a documented manual runbook for the
   first two Hetzner boxes.
7. **No golden images.** Servers clone template VMIDs 9000 to 9003 and marketplace apps 9100 and
   up. Nothing builds them. Add a Packer pipeline that produces Ubuntu, Debian, Rocky and app
   templates with cloud-init and the QEMU guest agent enabled, and an admin API to register them.
   Cloning also runs on the agent's own node with no target, so templates must exist on every
   node or the clone must pass a target node.
8. **NATS authentication.** Fixed: the production NATS server required a token that neither the
   API, the worker nor the host agent sent. All three now send `NATS_TOKEN`.
9. **Create retries leave orphan VMs.** Fixed: the create job id is derived from the server and
   the workflow, the agent answers a repeated id with the stored result (or waits for the run in
   progress), the request waits up to 10 minutes, and a failed create finds and deletes any VM
   tagged `server-<id>`.
10. **SSH access on real Proxmox.** Fixed in code: when user-data is supplied, the agent renders
    the SSH keys, hostname and default user into it (merged into a cloud-config, or as an extra
    part of a multipart document), and `sshkeys` is encoded with %20 and %0A. Still needs a
    real node test.
11. **Private network and tenant isolation.** Fixed in code, still needs a real cluster. Each
    project has a private network per region (a /24 from `PRIVATE_NETWORK_POOL`, default
    `10.96.0.0/12`) and every server gets a static address from it before its VM is created: the
    agent writes `ipconfig0 ip=<addr>/<prefix>` without a gateway and the control plane records it
    on `Server.privateIp`, so platform agents are reached on the private address from the first
    boot. The agent reads the guest's addresses through the QEMU guest agent after boot and in
    heartbeats, and the control plane warns on a mismatch without overwriting the allocation.
    `PRIVATE_NETWORK_MODE=sdn_vnet` (per region) gives each project network its own VNet in the
    `PROXMOX_VXLAN_ZONE` zone, created and applied by the agent; `shared_bridge` (the default)
    keeps every net0 on the `customers` bridge, separated only by subnet and the IP filter. The
    firewall turns on `ipfilter` with an `ipfilter-net<N>` IP set per NIC holding the allocated
    addresses (and the cluster VIP on managed nodes). Open: in `sdn_vnet` mode the control plane
    is not on the tenant VNets, so it cannot reach platform agents on their private addresses
    until a management path exists (an EVPN zone with a VRF per project and an exit node, or a
    management NIC on platform VMs); servers created before the switch stay on the shared bridge
    until they are rebuilt, and those created before static addresses keep DHCP (unfiltered on
    net0) until their next rebuild.
12. **Resize corrupts the VM config.** Fixed: resize sends only cores and memory and grows the
    disk, and rebuild attaches every volume the database shows attached to the new VM.
13. **Bandwidth billing is wrong.** Fixed: the agent sends outbound bytes since the previous
    tick, and rating charges per GB above the size's included transfer in each calendar month.
14. **Backups are same cluster snapshots** and they die with the VM. The restore workflow
    (`POST /v1/servers/{id}/restore`) and create from snapshot now exist; an off host copy (Proxmox
    Backup Server or the Hetzner Storage Box) is still needed before advertising backups.
15. **IP blocks and images have no admin API.** Fixed: `admin/v1/ip-blocks` and `admin/v1/images`, with
    back office pages.

## C. Blocks the managed products (build before selling each one)

16. **High availability is broken everywhere the same way.** keepalived binds the VIP on `eth0`,
    which is the private card on these VMs, the firewall drops VRRP (protocol 112) so every node
    elects itself master, and database, Kubernetes and load balancer nodes are placed without
    anti affinity so all three can share one physical host. Fix once in the shared cloud-init and
    firewall code and it fixes load balancers, Postgres, Valkey, MySQL and Kubernetes together.
17. **Agent channel is plaintext on public IPs.** Every platform agent on port 9009 speaks HTTP
    over the public address with a shared header secret, carrying database passwords, S3 keys and
    the Kubernetes join token. `CONTROL_PLANE_CIDR` was never set (fixed in the Ansible template)
    and `/status` needs no secret. Agents now listen on the private address, which the control
    plane allocates and records at create time (item 11), so it no longer falls back to the
    public address for new nodes. `CONTROL_PLANE_CIDR` now defaults to `10.0.0.0/12`, clear of
    the tenant pool `10.96.0.0/12`, and cluster traffic between nodes (replication, etcd, VRRP)
    is allowed from the cluster's own project network only. Still to do: TLS on the agent channel.
18. **Managed Postgres bootstrap.** The Ubuntu package creates a default cluster in the same data
    directory Patroni expects, the postgres password is never set, three node clusters skip user
    creation, the pgBackRest endpoint is passed as a URL, WAL archiving is on before a repository
    exists, and lag is never reported because member names differ. Needs a real VM test.
19. **Valkey and MySQL.** Valkey packages are likely absent from Ubuntu 24.04, XtraBackup needs
    the Percona repo, MySQL has no failover, and Sentinel is reset to node 0 on every push.
20. **No restore for any managed database**, and no resize, upgrade, node replacement or PITR.
21. **Kubernetes.** Node IP and flannel traffic likely blocked by the firewall, kubeadm
    certificates expire after a year with no rotation, no etcd backup, no upgrades, volumes are
    node pinned local PVs, and a PVC with a non Gi size crashes status parsing.
22. **App Platform.** Caddy runs on the host and proxies to Docker container names it cannot
    resolve, so every app would answer 502. Fixed: customer supplied repository, token, branch and
    commit are now shell quoted in the build agent, which closes a root command injection on the
    shared host. Still open: tenants share one Docker network with no sandbox, custom domains are
    not verified, per host HTTP-01 certificates will hit Let's Encrypt limits, and a failed host
    never gets its apps moved.
23. **Marketplace.** Customer user-data duplicates the app's cloud-init keys and can override the
    install; passwords use `Math.random`.
24. **Monitoring.** Disk metrics and alerts never fire on real hosts, and there are no metrics or
    alerts for databases, Kubernetes, apps or load balancers.

## D. Operating it (build before charging)

25. **Control plane HA and backups.** One host, one replica of everything, a nightly dump of only
    the app database (Temporal and PowerDNS are not dumped), no WAL archiving, an S3 copy that
    silently does nothing because the image lacks the CLI, and a restore that has never been
    tried. Do phase 1 from the hosting doc: separate app, data and workflow VMs, a streaming
    replica, pgBackRest to the Storage Box, and a tested restore runbook.
26. **Observability.** No platform metrics, no error tracking, no alerting and no status page.
    Fixed: the health endpoint now returns 503 when the database is down, so Docker and uptime
    checks see it. Add Prometheus, Grafana, Alertmanager, Loki and Sentry, and publish a status
    page (a hosted one is fine).
27. **Deploy pipeline.** The deploy workflow runs in parallel with CI rather than after it, and its
    job condition reads secrets, which GitHub rejects. Gate deploy on CI.
28. **Temporal** runs the auto setup development image on the app database with a single worker
    and no health check. Fine for a demo, not for production.
29. **Security hardening.** The default JWT secret is accepted in production, sessions cannot be
    revoked and live in local storage, staff are not forced onto 2FA and share one all powerful
    admin scope, outbound webhooks can be pointed at private addresses and signatures can be
    replayed, and the TOTP secret is stored in plaintext. None of these are hard; all should be
    done before launch.
30. **Team management.** No member invites, role changes, tax profile, or account closure, even
    though the refund policy says customers can close their account from the console.
31. **Tests.** Partly done. With the fake driver, every platform agent call now goes to an in
    process simulator (`apps/api/src/drivers/fake-platform-agents.ts`) that answers like the
    Python agents: same paths, status codes, JSON and shared secret, the database agent's 409
    until a primary and the users exist, and the app host's Docker and Caddy readiness. The
    fake driver gives each VM a private address on its project network. An integration suite
    (`apps/api/test/integration`, `pnpm test:integration`, the `integration` job in CI) boots the
    API and the Temporal worker with the real workflows against Postgres, Redis and Temporal, and
    covers signup, sessions, scoped API tokens, the prepaid gate and card top ups, servers,
    snapshots, volumes and public addresses, load balancers, one and three node Postgres with
    failover, Valkey, MySQL, Kubernetes with scaling, join tokens and the cloud controller, App
    Platform with custom domains and host failure, Git Deploy, rating, invoices with VAT,
    dunning and reinstatement, and limited staff with two factor sign in. It found and fixed
    four bugs: a scaled up Kubernetes node drained under a reused name, the volume of a deleted
    claim never released, a dead Postgres primary kept as primary after failover, and the
    system actor breaking the audit log on the first app host. Still missing: the Proxmox
    driver and the host agent against a real node, the real Python agents (the simulator
    follows their code but does not run it), Moyasar, PowerDNS and RGW, and the console.

## E. Claims to correct on the website until built

- "Every invoice is a ZATCA e-invoice" (about page and home copy) is not true yet.
- Region `sa1` is called Saudi Arabia 1 while the first host is in Falkenstein. Say so on the
  regions page until Saudi hosts exist. The residency claim itself was already removed.
- Docs promise minor version database updates, apps moving off failed hosts, and disk alerts.

## Suggested order

1. Two Hetzner boxes, Proxmox and Ceph by hand with a written runbook, one Packer image, and the
   first real server created through the API. Fix everything in section B that the test surfaces.
2. Moyasar on a real merchant account, atomic invoicing, prepaid requirement, suspension that
   works, and an e-invoicing provider. First paying customer on plain servers only.
3. Control plane phase 1 hosting, backups with a tested restore, monitoring and a status page.
4. The shared HA fix (VIP interface, VRRP, anti affinity, private agent network), then one managed
   product at a time, each with a fake agent in CI and a week on real VMs.
