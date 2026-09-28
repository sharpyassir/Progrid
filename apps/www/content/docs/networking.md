---
title: Firewalls and addresses
description: Host enforced firewall rules, public and private addresses, reserved IPs and reverse DNS.
section: Guides
order: 13
---

## Firewalls

A firewall is a named list of rules you attach to any number of servers. Rules are enforced on the host, outside the server, so a compromised server cannot loosen them.

Create one under **Security, Firewalls**: for each rule choose the direction, protocol, port or range, and the sources or destinations as CIDR blocks. A typical web server allows inbound TCP 22 from your office and 80 and 443 from anywhere, and everything outbound.

Attach it from the firewall page or from the server's **Networking** tab. Changes apply within seconds to every attached server. A server with no firewall accepts everything.

From the terminal, `prgd firewalls` lists them; creating and attaching is done in the console or through the API (`POST /v1/firewalls`, `POST /v1/firewalls/{id}/servers`).

## Addresses

Every server gets one public IPv4 address and one private address on its project's private network. Traffic between your servers over private addresses is free and never leaves the data center.

## Private networks

Each project has its own private network in every region it uses, created with the first server there. It is a /24 such as `10.96.3.0/24`; list yours with `GET /v1/private-networks`. Servers get addresses from `.2` upward, and `.1` is kept free.

- **Static and known in advance.** The address is assigned when the server is created and written into the server's network configuration, so it is on the first boot's interface and shown in the console and API before the server finishes booting. It stays with the server through reboots, resizes and rebuilds, and returns to the network when the server is deleted.
- **No gateway on the private interface.** The default route stays on the public interface. The private interface only reaches the other servers of the project in that region.
- **Managed products use it.** Databases, Kubernetes nodes, load balancers and App Platform hosts talk to each other and to your servers over their private addresses, and the platform manages them there.
- **Keep the address the platform assigned.** Changing it inside the server breaks private traffic (see below), and the platform flags the mismatch.

### Isolation

Private traffic of one project cannot reach another project's servers. In regions with network isolation, each project network is its own virtual network (a VXLAN segment) on the hypervisors, so other customers' servers are not on the same network at all. The private interface there has an MTU of 1450 bytes, which the server learns automatically; if you run your own overlay or containers across servers, size their MTU from that.

On top of that, the hypervisor only lets each network interface send from the addresses assigned to it: the private address on the private interface, the public address (and a reserved IP while it is attached) on the public one. A server that tries to use another address, including another customer's, has that traffic dropped before it leaves the host. Managed database, Kubernetes and load balancer nodes are also allowed their cluster's virtual IP, which moves between nodes on failover.

## Reserved IPs

A reserved IP belongs to your team rather than to a server. Move it between servers to switch traffic without changing DNS. Reserved IPs cost the same as a server address while attached and a small hourly fee while parked.

Move an address with `POST /v1/public-ips/{id}/detach`, then `POST /v1/public-ips/{id}/attach` with `{"serverId": "..."}`. The target server must not have a public address of its own, so detach that one first. A detached address stays reserved for your project until you release it with `DELETE /v1/public-ips/{id}`. The new address is live on the server after its next reboot.

## Reverse DNS

Set the reverse record for any of your addresses under **Core Cloud, Public IPs**. Mail servers need this to be accepted by other providers.
