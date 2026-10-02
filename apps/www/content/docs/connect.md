---
title: Progrid Connect
description: Build and deploy AI agents that connect to your infrastructure, APIs and applications.
section: Guides
order: 21
---

Progrid Connect turns a description of a job into an agent that does it. An agent has instructions, a model, tools that reach your APIs, databases and Progrid resources, and an optional workflow. You test it, deploy it, and call it from your own code with one HTTP request.

The flow is always the same: **Create Agent, Connect Tools, Test, Deploy.**

## 1. Create an agent

Open **Connect** in the console and choose one of three starts:

- **Template.** Customer Support, Sales Lead Qualifier, Data Analyst, Infrastructure Monitor, Research Assistant, Developer Assistant or Invoice Processor. Everything in a template can be edited.
- **Build with AI.** Describe the job in plain words, for example "Qualify leads from our website form and send good ones to our CRM". Connect drafts the instructions, tools, workflow, variables and the connections it needs. Nothing is saved until you review the draft and choose **Create**.
- **Blank.** Name it, write instructions, pick tools yourself.

From the API:

```sh
curl -X POST https://api.progrid.sa/v1/connect/agents \
  -H "Authorization: Bearer $PRGD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Support desk", "templateSlug": "customer-support"}'
```

Pick a model on the agent: **Claude Opus 5.5** (the default, best for multistep work), **Claude Sonnet 5.5** (fast, half the price) or **Claude Haiku 4.5** (fastest). **Effort** (low, medium, high) trades depth for speed and cost.

## 2. Connect tools

Tools are what the agent may do. Each tool has a snake_case name, a description that tells the model when to use it, and an input schema.

| Tool | What it does |
|---|---|
| HTTP request | Calls a REST API through a connection: method, path with `{param}` placeholders, query, headers and body. |
| Database query | Runs read only SQL on PostgreSQL or MySQL, or find and aggregate on MongoDB. |
| Send email | Sends through Progrid mail (limited per hour) or your own SMTP server. |
| Notify | Email, an outbound webhook, or an entry in your Progrid activity feed. |
| Outbound webhook | Posts a signed JSON event to your endpoint. |
| Progrid | Lists servers, metrics, databases, buckets and apps, reads app logs, opens tickets, and powers servers on or off. |

### Connections

Credentials live in **Connections**, not in tools. Create one per API, database, mail server or webhook endpoint. Secret values (tokens, passwords, signing secrets) are encrypted the moment they arrive and are never shown again; you see only a hint like `••••abcd`. The model never sees them either.

```sh
curl -X POST https://api.progrid.sa/v1/connect/connections \
  -H "Authorization: Bearer $PRGD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Store API",
    "kind": "rest_api",
    "config": {"baseUrl": "https://api.example.com/v1", "auth": {"type": "bearer"}},
    "secrets": {"token": "sk_live_..."}
  }'
```

Choose **Test** on a connection to check it works.

Database connections are **read only by default**. Connect checks every query before it runs and the database runs it in a read only transaction, so a write fails twice. You can also list the only tables (or collections) the agent may read. For the strongest guarantee, give the connection a database user that can only read those tables.

Agents can only reach public addresses. Private networks, loopback and cloud metadata addresses are blocked, also after redirects.

### Variables

Variables hold values your instructions and tools use, like `{{vars.COMPANY_NAME}}`. Mark a variable **secret** for API keys: secret values are only filled into tool requests and never into what the model reads.

## 3. Test

Open the **Test** tab, type a message or paste JSON input, and run. You see every step as it happens: each model call with its tokens, each tool call with its input, output and time, conditions, approvals, the final answer, errors and the total cost estimate. Switch to raw JSON to see everything. Tests run your latest draft.

```sh
curl -X POST https://api.progrid.sa/v1/connect/agents/$AGENT_ID/test \
  -H "Authorization: Bearer $PRGD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Where is order 10045?"}'
```

### Workflows

A workflow chains steps: **Trigger, AI Agent, Tool, Condition, Action**, plus Transform and End. Steps refer to earlier data with `{{trigger.body}}`, `{{steps.<id>.output}}` and `{{vars.KEY}}`. A condition such as `{{steps.qualify.output.score}} >= 80` sends the run down its true or false branch. An agent step can return structured JSON by giving it an output schema, so later steps can use its fields. Without a workflow, an agent simply answers each call.

Triggers: the run API, an inbound webhook, a schedule (cron) or a manual run.

### Approvals

Anything that changes your infrastructure, like powering a server off, waits for a person. You can also mark any tool **Requires approval**. The run pauses with status `waiting_approval`, team owners and admins get an email, and the request appears under **Approvals**. Approve and the run continues; deny and it stops.

## 4. Deploy

Save a version with a note, then choose **Deploy**. Connect serves that immutable version. Later edits stay in the draft until you deploy again, and you can roll back by deploying an earlier version. **Pause** stops the agent from answering.

A deployed agent gets:

- an API endpoint: `https://api.progrid.sa/v1/connect/agents/{id}/run`
- agent API keys, created on the agent's **Deploy** tab or under **Connect, Keys**. A key starts with `prgd_ca_` and is shown once.
- webhook URLs that start a run when they are called

## Call your agent

Every deployed agent has a run endpoint:

```sh
curl -X POST https://api.progrid.sa/v1/connect/agents/$AGENT_ID/run \
  -H "Authorization: Bearer $PRGD_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"message": "Where is order 10045?"}}'
```

```json
{
  "runId": "cm8x...",
  "status": "succeeded",
  "output": {"text": "Order 10045 shipped yesterday and arrives Thursday."},
  "error": null,
  "usage": {"model": "claude-opus-5-5", "inputTokens": 1830, "outputTokens": 214, "toolCalls": 1},
  "durationMs": 4120
}
```

JavaScript:

```js
const res = await fetch(`https://api.progrid.sa/v1/connect/agents/${agentId}/run`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.PRGD_AGENT_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ input: { message: "Where is order 10045?" } }),
});
const run = await res.json();
```

Python:

```python
import os, requests

run = requests.post(
    f"https://api.progrid.sa/v1/connect/agents/{agent_id}/run",
    headers={"Authorization": f"Bearer {os.environ['PRGD_AGENT_KEY']}"},
    json={"input": {"message": "Where is order 10045?"}},
    timeout=90,
).json()
```

The **API** tab of each agent shows these examples with its own endpoint, plus PHP.

- The call waits up to 60 seconds. Longer runs answer `202` with a `statusUrl` to poll.
- Send `"async": true` to get `202` at once, then poll `GET /v1/connect/agents/{id}/runs/{runId}` with the same key.
- Send an `idempotencyKey` to retry safely: the same key within 24 hours returns the same run.
- Output is JSON: `{"text": ...}` for a plain agent, or what the workflow's End step returns.

| Status | Meaning |
| --- | --- |
| 401 | Bad or missing key |
| 402 | Spend limit reached or payment required |
| 404 | Unknown agent |
| 409 | Agent is not deployed |
| 429 | Too many requests |

## Webhooks

Add a webhook to an agent to start runs from other systems (a form, a CRM, a payment provider). You get a URL like `https://api.progrid.sa/v1/connect/hooks/{id}/{token}`, shown once. Whatever JSON is posted to it becomes the run input, available as `{{trigger.body}}`. The call answers `202` with the run id.

Turn on **signing** to require a signature. Compute `HMAC-SHA256(signingSecret, "<unix seconds>.<raw body>")` and send `X-Prgd-Signature: t=<unix seconds>,v1=<hex>`. Signatures older than five minutes are refused. **Rotate** issues a new URL and secret and retires the old ones at once.

Webhook payloads are treated as untrusted data: the agent is told never to follow instructions that arrive inside them.

## Logs and usage

**Logs** lists every run of every agent with status, source, duration, tokens and errors, and opens the full step timeline.

**Usage** shows the month: executions, workflow executions, AI tokens in and out, cache reads and writes, tool calls, API calls, compute time and stored log data. It breaks this down per agent, per model and per day, with the estimated cost. Usage is billed with the rest of your Progrid usage, and your project spend limits apply. A run that would pass the limit is refused with `402`.

## Pricing

Connect is pay as you go. There is no monthly fee and no monthly minimum. Prices are in Saudi riyals and exclude 15% VAT. Teams billed in US dollars pay the same prices converted at the pegged rate of 3.75 riyals per dollar.

| What | Price |
|---|---|
| Execution (one agent run or one workflow execution) | SAR 0.04 |
| Tool call (each API, database, email, notification or Progrid action) | SAR 0.02 |

AI tokens are priced per model, per 1M tokens:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Claude Opus 5.5 | SAR 18.00 | SAR 90.00 | SAR 0.90 | SAR 22.50 |
| Claude Sonnet 5.5 | SAR 9.00 | SAR 45.00 | SAR 0.90 | SAR 11.25 |
| Claude Haiku 4.5 | SAR 4.50 | SAR 22.50 | SAR 0.45 | SAR 5.625 |

If Claude Opus 5.5 declines a request for safety reasons, Connect retries it on Claude Opus 5 or Claude Opus 4.8. Both attempts are billed, each at its own model's prices. For those two models the prices per 1M tokens are SAR 22.50 input, SAR 112.50 output, SAR 2.25 cache read and SAR 28.125 cache write. You cannot choose them for an agent.

Connect caches the platform preamble, the agent instructions and the tool list, so calls after the first read them from the cache for a small part of the input price. Writing to the cache costs 1.25 times the input price.

Each run shows its estimated cost in the Test tab, the run view and the logs. `GET /v1/connect/models` returns each model's prices in your currency, and `GET /v1/connect/usage` returns the month's estimate.

**Example.** One Claude Opus 5.5 run with 12,000 input tokens, 1,500 output tokens, 40,000 cache read tokens, 8,000 cache write tokens and 2 tool calls costs SAR 0.04 + 2 × 0.02 + 0.216 + 0.135 + 0.036 + 0.18 = SAR 0.647, plus VAT.

## Permissions

Team owners and admins create, edit, test and deploy agents and manage connections and keys. Members can see agents, runs, logs, connections (without secrets) and usage. API tokens need the `connect:read` or `connect:write` scope.
