# Physical security and shared responsibility

| | |
|---|---|
| Document owner | [Operations lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, and when a hosting provider or location changes |
| ISO/IEC 27001:2022 | Annex A 7.1-7.14, 5.23, 8.10 |
| NCA | ECC Defense domain (physical security); ECC Third-party and cloud computing domain; DCC (secure disposal) |
| Checklist | Controls 139-144, 62 |

## 1. Purpose

State who protects what between Progrid, its infrastructure providers and its customers, and how
Progrid handles physical media and equipment it is responsible for.

## 2. Shared responsibility

Progrid operates no data centre. [Owner to confirm: Progrid has no office in scope; if an office
is opened, add it here.]

| Layer | DigitalOcean (control plane droplet, FRA1) | Hetzner (dedicated servers, Falkenstein) | Progrid | Customer |
|---|---|---|---|---|
| Buildings, physical access, CCTV, guards | Provider | Provider | Verify provider evidence | — |
| Power, cooling, fire suppression, environmental controls | Provider | Provider | Verify evidence; place nodes for redundancy | — |
| Network uplinks, upstream DDoS filtering | Provider | Provider | Host firewalls, rate limits, emergency filtering | Own firewall rules on their servers |
| Server hardware, disk replacement | Provider (virtualised) | Provider replaces failed parts on request | Request swaps; handle returned media (§4) | — |
| Hypervisor | Provider (droplet) | **Progrid** (Proxmox VE) | Patch, harden, isolate tenants | — |
| Host OS of the management host | — | — | **Progrid** | — |
| Control plane application and data | — | — | **Progrid** | — |
| Guest OS, applications and data inside customer VMs | — | — | Platform isolation only | **Customer** |
| Customer backups and encryption inside VMs | — | — | Offer features | **Customer** |
| Managed cloud contracts (customer servers we operate) | — | — | As in the contract's responsibility matrix (`/admin/managed/contracts/{id}/responsibilities`) | As in the matrix |
| Identity and access to Progrid accounts | — | — | Platform controls (MFA, roles) | Their users, tokens and MFA |

## 3. Provider evidence

For each data centre provider, obtain and file under `evidence/18-physical/<provider>/`:

| Item | DigitalOcean | Hetzner |
|---|---|---|
| ISO/IEC 27001 certificate (scope covers the location used) | To verify and file | To verify and file (Hetzner publishes ISO/IEC 27001 certification for its data centre parks; confirm scope covers Falkenstein) |
| SOC 2 Type II or SOC 3 report | To request and file | If available |
| Description of physical access control, power redundancy (UPS, generators), cooling, fire detection and suppression | From provider documentation | From provider documentation |
| Data processing agreement | To file | To file (Hetzner AV contract) |

Review yearly with the supplier review. Record the date, the document version and expiry.

## 4. Media sanitisation and hardware decommissioning

### 4.1 Rules

1. Storage that held customer content or Progrid Restricted data shall be sanitised before it
   leaves Progrid's control (cancelled server, returned disk, auction server handed back).
2. Methods follow NIST SP 800-88 Rev. 1 (Clear/Purge): for NVMe, NVMe Format with secure erase
   or sanitize; for SATA SSD, ATA Secure Erase; for HDD, a full overwrite. Cryptographic erase
   applies once disks are encrypted (planned).
3. Each sanitisation is recorded (§4.4).

### 4.2 Decommissioning a Hetzner dedicated server (including auction servers)

1. **Plan.** Open a change; confirm no customer VM or platform VM remains (migrate or delete;
   tell customers if needed). Remove the node from scheduling (mark it unavailable in the
   control plane).
2. **Remove from the platform.** Stop the host agent; remove the node from the Proxmox cluster
   and from Ceph (when used); revoke its Proxmox API token (`prgd@pve!agent`) and NATS access;
   remove its WireGuard peer from the management host and the inventory; remove its IPs from
   `admin/v1/ip-blocks` assignments.
3. **Back up** anything that must be kept (should be nothing on a node).
4. **Sanitise.** Boot the Hetzner rescue system. For each disk: identify it (`lsblk`,
   `nvme list`), then
   - NVMe: `nvme format /dev/nvmeXn1 --ses=1` (user data erase) or `nvme sanitize` where
     supported; confirm with `nvme sanitize-log` where applicable;
   - SATA SSD: `hdparm --user-master u --security-set-pass p /dev/sdX` then
     `hdparm --user-master u --security-erase p /dev/sdX` (check the drive is not frozen);
   - HDD or a drive where secure erase fails: `shred -n 1 -z /dev/sdX` (or `blkdiscard` followed
     by an overwrite).
   - Verify: read random sectors (`dd if=/dev/sdX bs=1M count=10 skip=<random> | hexdump -C`)
     show zeros or no prior data.
5. **Record** the server id, disks (model, serial), method, result, date and person (§4.4).
6. **Cancel** the server in Hetzner Robot only after the record is complete.
7. **Clean up**: DNS (reverse DNS), monitoring, asset register entry marked "decommissioned".

### 4.3 Failed disk replaced by Hetzner

If the disk can still be addressed, sanitise it before requesting the swap. If it cannot, record
that the provider takes custody of an unsanitised failed disk, rely on the provider's destruction
process (evidence from §3), and assess whether customers must be told (normally not, when the
disk was part of a mirror and unreadable alone; record the reasoning). Disk encryption (planned)
removes this residual risk.

### 4.4 Sanitisation record

`evidence/18-physical/sanitisation-log.csv`: date, server id, location, disk model, serial,
method, verification, performed by, change id.

## 5. Company-owned and personal equipment

1. Laptops used for production access (company or personal) shall: use full disk encryption,
   lock the screen after 5 minutes, run a supported OS with automatic updates, run endpoint
   protection where available, keep SSH keys protected by a passphrase or on a hardware token, and
   not be shared with other people (people-security.md §6).
2. An inventory of devices used for privileged access is kept by the People owner (asset register
   AS-58).
3. Lost or stolen devices are reported at once as an incident; credentials on them are revoked.
4. At the end of use, company devices are wiped (OS reset with encryption) before reuse or
   disposal, and recorded.

## 6. Roles

Operations lead: provider evidence, decommissioning, sanitisation records. People owner: device
inventory. Security owner: reviews evidence yearly.

## 7. Evidence produced

Filed provider certificates and reports, sanitisation log, decommissioning change records, device
inventory, lost-device incident records.

## 8. Review cycle

Yearly, with the supplier review.

## 9. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.23, 7.1-7.14, 8.1, 8.10 |
| NCA ECC | Defense: physical security; Third-party and cloud computing cybersecurity |
| NCA DCC | Secure data disposal |
| Checklist | 62, 139-144 |
