---
title: API guide
description: Conventions that hold across every endpoint. Read this once, then use the reference.
section: Guides
order: 10
---

The API powers the console, the CLI, the MCP server and every SDK. There is nothing the console can do that the API cannot. The full reference is generated from the OpenAPI spec at [/docs/api-reference](/docs/api-reference).

## SDKs and Terraform

- **TypeScript**: `npm install @pgcloud/sdk`, types generated from the OpenAPI document, works anywhere `fetch` exists.
- **Python**: `pip install pgcloud`, no dependencies.
- **Terraform**: the `pgcloud/pgcloud` provider with `pgcloud_server`, `pgcloud_firewall`, `pgcloud_ssh_key` and data sources for sizes and images.

All three send an idempotency key on every write and surface API errors with their code, including `approval_required` when a person has to approve an agent's request.

## Base URL and auth

```
https://api.progrid.sa/v1
Authorization: Bearer pgc_...
```

Tokens are created under **Managed Agents, Agent Access** or with `pgcloud tokens create`. Each token has scopes such as `servers:write` or `billing:read`; a call outside its scopes fails with `403 forbidden`.

## Requests and responses

- JSON in, JSON out. Lists come as `{ "data": [...], "meta": { "next_cursor": "..." } }`.
- Long operations return `202 Accepted` with the resource in a transitional status such as `provisioning`. Poll it, or subscribe to webhooks.
- Money is integer minor units with an explicit currency: `{ "amountMinor": 600, "currency": "USD" }` is six dollars.

## Idempotency

Send an `Idempotency-Key` header on any create or action call. Repeating the same key within 24 hours returns the first response instead of doing the work again. The same key with a different body is rejected with `409 idempotency_key_reused`. The CLI and MCP server always send one.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "spend_limit_reached", "message": "...", "details": { "capMinor": 1500 } } }
```

| Code | Meaning |
|---|---|
| `invalid_request` | a field is missing or wrong; `message` says which |
| `unauthorized` | no token, or it was revoked |
| `forbidden` | the token lacks the scope |
| `approval_required` | parked for a person to approve; `details.approvalId` |
| `spend_limit_reached` | the token's monthly cap would be exceeded |
| `email_unverified` | confirm the owner's email first |
| `invalid_state` | the server is busy; retry when it is active or off |
| `rate_limited` | slow down; `Retry-After` says how long |

Webhook events for monitoring are `alert.triggered` and `alert.resolved`; see the [monitoring guide](/docs/monitoring).

## Rate limits

600 requests per minute per token or session, 120 per minute per address when anonymous, 10 sign in attempts per minute per address. Over the limit you get `429` with a `Retry-After` header.

## Webhooks

Register a URL under **Projects, Webhooks** with the events you want, such as `server.active`, `invoice.issued` or `approval.requested`. Every delivery carries `X-Pgcloud-Signature: t=<unix seconds>,v1=<hex>` where the hex is HMAC SHA256 of `<t>.<body>` with the webhook secret; reject deliveries whose `t` is older than five minutes so a captured request cannot be replayed. Only https URLs on public hosts are accepted. Deliveries are retried with backoff for a day and listed with their response in the console.
