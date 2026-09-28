---
title: DNS
description: Host your domains on our nameservers for free, with every record type and reverse DNS.
section: Guides
order: 17
---

## Add a domain

DNS hosting is free. Add the domain from the console under **DNS**, from the CLI, or the API:

```
prgd domains add example.com --ip 203.0.113.5
```

```
POST /v1/domains
{ "name": "example.com", "ip": "203.0.113.5" }
```

The response lists our nameservers. Set them at your registrar and the zone is live once the
registrar's change propagates, usually within an hour. The optional `ip` creates an A record at
the apex right away, for example a load balancer or server address.

A domain can be hosted by one account. If a parent domain is already hosted by someone else,
they have to delegate your subdomain to you with NS records.

## Records

| Type | Content | Notes |
| --- | --- | --- |
| A | IPv4 address | |
| AAAA | IPv6 address | |
| CNAME | hostname | not at the apex, and alone at its name |
| MX | mail server hostname | `priority` is the preference, default 10 |
| TXT | text | SPF, DKIM, verification strings; we add the quotes |
| NS | nameserver hostname | for delegating a subdomain; the apex NS set is ours |
| SRV | `weight port target` | name like `_sip._tcp`; `priority` default 10 |
| CAA | `flags tag value` | for example `0 issue letsencrypt.org` |

Names are relative to the zone: `www`, `_dmarc`, `*.dev`, or `@` for the zone itself. TTL is
30 seconds to a week, 3600 by default.

```
prgd domains records example.com add A www 203.0.113.5 --ttl 300
prgd domains records example.com add MX @ mail.example.com --priority 10
prgd domains records example.com add TXT @ "v=spf1 mx -all"
```

Every change bumps the zone serial and is pushed to the nameservers within seconds; the zone
page shows **published** when they serve the current serial. Resolvers keep old answers until
the previous TTL runs out, so lower the TTL a day before a planned move.

`GET /v1/domains/{name}/zone-file` returns the zone in BIND format for backups or migration.

## Reverse DNS

Set the PTR for any public IP in your project from the **Public IPs** page, with
`prgd domains rdns IP_ID mail.example.com`, or `PUT /v1/public-ips/{id}/reverse-dns`. Mail
servers should have a PTR that matches their forward A record. Clear it by sending `null`.

## Terraform, SDKs and agents

Terraform manages zones with `prgd_domain` and records with `prgd_dns_record`. The SDKs
expose `domains` with record helpers and `setReverseDns`. Agent tokens need `dns:read` and
`dns:write`; the MCP server exposes `list_domains`, `create_domain` and `dns_record`.

## Limits

| Limit | Value |
| --- | --- |
| Zones per project | 100 |
| Records per zone | 1000 |
| TTL | 30 s to 604800 s |
