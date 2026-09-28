---
title: AI agents and MCP
description: Give Claude Code, Cursor or any agent a token with a spending cap, then let it create and manage servers.
section: Start here
order: 4
---

An agent is just another API client. What makes it safe is the token you give it: scopes limit what it can call, a monthly spending cap limits what it can cost, and approval rules park risky actions for you to decide.

## 1. Create an agent token

In the console under **Managed Agents, Agent Access**, or from the terminal:

```sh
prgd tokens create claude --agent --cap 15
```

This token can read and create servers and deploys, may spend at most $15 per month, and must ask before deleting a server or resizing one down. The token is shown once. Copy it.

## 2. Connect the MCP server

The MCP server exposes Progrid as tools to any MCP client.

```sh
claude mcp add prgd -e PRGD_TOKEN=prgd_... -- npx -y prgd-mcp
```

For Cursor or another client, add the same command to its MCP settings. The tools are `list_servers`, `get_server`, `list_sizes`, `list_images`, `create_server`, `server_action`, `delete_server`, `deploy_repository`, `list_deployments`, `redeploy`, `get_billing`, `list_firewalls` and `get_approval`.

## 3. Ask for what you want

> Create a small Ubuntu server called staging, deploy github.com/acme/api on it, and tell me the address.

The agent lists sizes with prices, creates the server, waits for it to be active, deploys the repository and reports back. If it hits the cap it gets a `spend_limit_reached` error with a hint and tells you instead of trying something else.

## Approvals

When a token has approval rules, the matching call is parked. You get an email and see it under **Managed Agents, Approval Queue**, with the exact request. Approve and it runs immediately, still under the token's cap. Deny with a reason and the agent can read why. Requests expire after 24 hours.

Agents poll the decision with `get_approval`, or simply carry on with other work.

## Plain API use

Any language works. The token goes in the `Authorization` header:

```sh
curl https://api.progrid.sa/v1/servers \
  -H "Authorization: Bearer prgd_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"staging","size":"s-1vcpu-1gb","image":"ubuntu-24-04"}'
```

See the [API guide](/docs/api) for conventions and the [reference](/docs/api-reference) for every endpoint.
