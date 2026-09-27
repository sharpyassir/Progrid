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
| Networking (public IPs, firewall, private network) | Public IP and firewall written; private network and IPv6 missing | Build |
| Volumes, object storage, DNS | Written against Ceph RBD, RGW and PowerDNS; never run on real ones | Test on real cluster |
| Managed databases, Kubernetes, App Platform | Written end to end; agents never booted on a real VM | Expect a hardening pass of one to two weeks each |
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
9. **Create retries leave orphan VMs.** The NATS request times out after 3 minutes while a clone
   can take 10, and each retry uses a new job id, so the agent cannot deduplicate. Use the server
   id as the job id and write the driver reference before the clone finishes.
10. **SSH access on real Proxmox.** Any cloud-init user-data (marketplace, managed tier, platform
    nodes) replaces the Proxmox generated user-data, so SSH keys and hostname are dropped unless
    the rendered user-data carries them. The `sshkeys` field is also URL encoded with plus signs
    for spaces, which Proxmox may not decode. Both need a real node test and a fix.
11. **Private network and tenant isolation.** Every VM sits on one shared bridge with DHCP and no
    per tenant VNet, VXLAN or address assignment, so the private IP is never filled and tenants
    can see each other. Build per project VNets with the Proxmox SDN and IPAM, and enable
    `ipfilter` so customers cannot spoof addresses.
12. **Resize corrupts the VM config.** The resize job resends an empty name and tags and a NIC
    without its MAC, which wipes usage attribution tags and changes the MAC. Rebuild also drops
    attached volumes while the database still shows them attached.
13. **Bandwidth billing is wrong.** Cumulative since boot counters are summed and priced per
    minute rather than per GB, with no included transfer. Meter deltas and bill overage per GB.
14. **Backups are same cluster snapshots** with no restore path and a fake size, and they die
    with the VM. Add a restore workflow and an off host copy (Proxmox Backup Server or the Hetzner
    Storage Box) before advertising backups.
15. **IP blocks and images have no admin API.** Only the seed inserts the documentation range.

## C. Blocks the managed products (build before selling each one)

16. **High availability is broken everywhere the same way.** keepalived binds the VIP on `eth0`,
    which is the private card on these VMs, the firewall drops VRRP (protocol 112) so every node
    elects itself master, and database, Kubernetes and load balancer nodes are placed without
    anti affinity so all three can share one physical host. Fix once in the shared cloud-init and
    firewall code and it fixes load balancers, Postgres, Valkey, MySQL and Kubernetes together.
17. **Agent channel is plaintext on public IPs.** Every platform agent on port 9009 speaks HTTP
    over the public address with a shared header secret, carrying database passwords, S3 keys and
    the Kubernetes join token. `CONTROL_PLANE_CIDR` was never set (fixed in the Ansible template)
    and `/status` needs no secret. Move agents to the private network and add TLS.
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
31. **Tests.** Six test files in the repository. Nothing covers payments, invoices, IAM, the auth
    guard, admin or workflows, and the fake driver does not simulate the node agents, so the
    managed products have never been exercised even in simulation. Add fake agents and an
    integration suite that runs in CI.

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
