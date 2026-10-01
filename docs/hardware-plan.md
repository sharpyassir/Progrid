# Hardware plan

Progrid launches on rented dedicated servers in Europe, then moves to Saudi located hosts once there are paying customers. This page records the plan so the platform's assumptions (regions, capacity, backups, latency) match it.

## Primary: Hetzner Server Auction, Falkenstein

- Source: https://www.hetzner.com/sb/
- Auction servers exist in Falkenstein and Helsinki. Falkenstein is the choice: it routes through Frankfurt and is closer to Saudi Arabia. Helsinki adds latency.
- Bandwidth: a dedicated 1 Gbit/s uplink with unlimited traffic, no setup fee, no minimum contract.
- Expected latency from Saudi Arabia: roughly 80 to 120 ms.
- Target models:
  - AX41-NVMe: 64 GB RAM, 2 × 512 GB NVMe, about 37 EUR a month.
  - AX42: 8 core Ryzen, 64 GB DDR5 ECC, 1 TB NVMe, about 46 EUR a month.
- The primary IPv4 address is an add on at 1.70 EUR a month. Extra addresses come as a /29 or larger subnet, which is what the platform's IP blocks map to.
- Hetzner holds an ISO 27001:2022 certificate, which helps with CST registration.

## The first server (ordered)

An auction server in Falkenstein: Intel i7-6700 (4 cores, 8 threads), 64 GB RAM, 2 x 512 GB NVMe,
1 Gbit/s, one IPv4 address. It runs as a single Proxmox VE 8 node (lab and first customers), set up
by hand with `docs/first-proxmox-node.md`:

- Debian 12 by installimage, software RAID 1 over both NVMe drives, LVM: 80 GB root, 8 GB swap, the
  rest (about 385 GB) as the LVM thin pool behind the `vm-disks` storage. No Ceph on one node; the
  host agent runs with `storage_type: lvmthin`.
- Public addresses are routed: the main IP on the NIC, an additional subnet routed by Hetzner to the
  main IP and on to the bridge `vmbr0`. No virtual MACs needed. Order a /29 (5 usable server
  addresses after network, broadcast and the gateway kept by the node) or larger; single
  additional IPs do not fit the platform's IP blocks yet.
- It reaches the control plane on the DigitalOcean droplet over WireGuard (`10.9.0.0/24`).

## Backups: Hetzner Storage Box

Same provider and network, so backups are fast and cheap (about 4 to 5 EUR a month). The platform's object storage provider for backups can point at it over SFTP or through a small S3 gateway until Ceph RGW exists.

## Price tracking before buying

Server Radar (https://radar.iodev.org/) tracks auction prices with history and alerts on drops.

## Secondary and failover: OVHcloud Eco range

Kimsufi or So you Start. OVHcloud excluded its Eco range from its April 2026 price increases. A second provider protects against an account suspension or an outage at Hetzner.

## Before ordering

Test latency from Saudi Arabia on STC and Mobily lines: ping and traceroute to Hetzner's Falkenstein test addresses and speed test files, and the same for OVH. Real numbers from customers' ISPs matter more than published estimates.

## Later phase

Once there are paying clients, compare Saudi located options (Riyadh or Jeddah) to cut latency to 5 to 15 ms. That also makes data residency questions easier.

## How this maps onto the platform

- One region, `sa1` "Saudi Arabia 1", stays the customer facing region name; the first host lives in Falkenstein and the region description can say so until the move.
- One AX41 or AX42 (64 GB) hosts about 20 Starter servers, 12 Standard, 6 Pro or 3 Business at full commitment, before shared app hosts and managed database nodes. Order the second server when memory commitment passes 70 percent.
- Public IPs come from a Hetzner subnet routed to the host; register it as an IP block in the back office with the node's address on `vmbr0` (the subnet's first usable address) as the gateway.
- Daily backups and managed database backups go to the Storage Box through the platform's object storage endpoint.
- The failover server at OVH runs the control plane database replica and can take new servers if Hetzner is unavailable; it is a second region in the back office, hidden until needed.
