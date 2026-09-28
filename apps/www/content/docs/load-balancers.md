---
title: Load balancers
description: A public IP with HAProxy behind it, spreading traffic over your servers with health checks and free TLS.
section: Guides
order: 16
---

## What you get

A load balancer is a public IP that we keep answering for you. Behind it run one to three
HAProxy nodes that we create, patch and replace; with two or more nodes the IP moves to a
healthy node within a second if one fails. Each node is charged per month, and the IP is
included. Target servers are your own servers in the same region; the load balancer reaches
them over the private network.

## Create one

From the console open **Load balancers**, or from the CLI:

```
prgd load-balancers create web --rule http:80:80 --server web-1 --server web-2 --wait
```

Through the API:

```
POST /v1/load-balancers
{
  "name": "web",
  "nodes": 2,
  "forwardingRules": [{ "entryProtocol": "http", "entryPort": 80, "targetProtocol": "http", "targetPort": 80 }],
  "serverIds": ["srv_..."]
}
```

The call returns at once with the IP and status `creating`. The nodes boot in a minute or two
and the status becomes `active` when every node runs the configuration. Point your DNS at the
IP.

## Forwarding rules

A rule maps an entry port on the load balancer to a port on every target.

| Entry | Target | Use |
| --- | --- | --- |
| http | http | plain web traffic; the load balancer adds `X-Forwarded-For` and `X-Forwarded-Proto` |
| https | http | TLS ends on the load balancer with the rule's certificate; targets speak plain HTTP |
| tcp | tcp | anything else, passed through byte for byte, including TLS you terminate yourself |

Turn on **redirect HTTP to HTTPS** to send port 80 to the HTTPS rule with a 301. Turn on
**proxy protocol** when your targets understand it and you need the client address on TCP
rules.

## Certificates

Two kinds, both under **Certificates** on the load balancers page or `prgd certificates`:

- **Let's Encrypt:** give the domain names, point them at the load balancer IP, and use the
  certificate in an HTTPS rule. The nodes issue the certificate over HTTP validation and renew
  it on their own. Until issuance completes the rule serves a temporary self signed certificate.
- **Uploaded:** paste the certificate chain and private key in PEM form. The expiry date is
  read from the certificate and shown in the list.

## Health checks and targets

Every node checks each target at the interval you set (10 seconds by default) on the health
check port and path. A target that fails the check three times in a row stops receiving
traffic and comes back after three successes. Target health is shown on the load balancer page
and the API, and `load_balancer.target_unhealthy` and `target_healthy` events go to your
webhooks.

Add targets by id, or set a **tag**: every server in the project carrying that tag joins
automatically, including servers you create later.

## Algorithms and sticky sessions

Round robin sends requests to targets in turn; least connections sends each request to the
target with the fewest open connections, which suits long requests. Sticky sessions pin a
browser to one target with a cookie, for applications that keep state in memory.

## Changing and deleting

Rules, health check, algorithm, sticky sessions, redirect and targets change in place; the new
configuration rolls out to every node within seconds and the version each node runs is shown
on the page. The name, region and node count are fixed at creation. Deleting a load balancer
deletes its nodes and releases the IP; the target servers are untouched.

## Terraform, SDKs and agents

Terraform manages a load balancer with the `prgd_load_balancer` resource and
`forwarding_rule` blocks. The SDKs expose `loadBalancers` and `certificates` with a
`waitUntilActive` helper. Agent tokens need `network:read` and `network:write`; the MCP server
exposes `list_load_balancers`, `create_load_balancer`, `load_balancer_servers` and
`delete_load_balancer`.

## Limits

| Limit | Value |
| --- | --- |
| Nodes | 1 to 3 |
| Forwarding rules | 20, one per entry port |
| Targets | 100, same region |
| TLS | TLS 1.2 and 1.3, HTTP/2 to the client |
