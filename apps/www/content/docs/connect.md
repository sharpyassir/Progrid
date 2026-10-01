---
title: Progrid Connect
description: Build and deploy AI agents that connect to your infrastructure, APIs and applications.
section: Guides
order: 5
---

Progrid Connect runs AI agents for you. An agent has instructions, tools that reach your APIs and databases, an optional workflow, and its own API endpoint. You build it in the console under **Connect**, test it, then deploy it.

## 1. Create an agent

Open **Connect, Agents** and choose **Create agent**. There are three ways to start:

- **Start blank.** Give it a name and write the instructions in plain sentences.
- **Build with AI.** Describe what the agent should do. You get a draft with instructions, tools, a workflow and the variables it needs. Nothing is saved until you choose **Create agent**.
- **From template.** Start from Customer Support, Sales, Data Analyst, Monitoring, Research, Developer or Invoice.

## 2. Connect tools

Tools are what the agent may call. Each tool has a snake_case name and a description that the model reads.

| Tool | What it does |
| --- | --- |
| REST API | Calls an endpoint of your API, through a saved connection or any allowed host. |
| Database query | Reads from PostgreSQL, MySQL or MongoDB. Read only unless the connection allows writes. |
| Email | Sends email through Progrid mail or your SMTP server. |
| Notification | Alerts a person by email, webhook or in the Progrid console. |
| Webhook | Posts JSON to an outbound webhook. |
| Progrid services | Lists servers, reads metrics and app logs, opens tickets. Actions that change resources wait for approval. |

Credentials live in **Connect, Connections**. They are encrypted and write-only: after saving you only see the last characters. Turn on **Requires approval** for any tool a person should confirm before it runs.

## 3. Test

The **Test** tab sends a message or a JSON event to your current draft and shows each step as it happens: model calls, tools, API calls, conditions, execution time, tokens and a cost estimate. Switch to raw JSON to see everything.

## 4. Deploy

Save a version with a note, then deploy it. The agent gets:

- an API endpoint: `https://api.progrid.sa/v1/connect/agents/{id}/run`
- agent API keys, shown once when you create them
- webhook URLs that start a run when they are called

## Call your agent

```bash
curl -X POST https://api.progrid.sa/v1/connect/agents/{id}/run \
  -H "Authorization: Bearer $PRGD_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"email": "sara@company.com", "company": "Company Ltd"}}'
```

A run waits up to 60 seconds and returns `runId`, `status`, `output`, `usage` and `durationMs`. Send `"async": true` to get a run ID at once and poll `GET /v1/connect/agents/{id}/runs/{runId}`. Send an `idempotencyKey` to make retries safe.

| Status | Meaning |
| --- | --- |
| 401 | Bad or missing key |
| 402 | Spend limit reached or payment required |
| 404 | Unknown agent |
| 409 | Agent is not deployed |
| 429 | Too many requests |

## Workflows

A workflow chains steps: Trigger, AI Agent, Tool, Condition, Action, Transform and End. Templates refer to earlier data with `{{trigger.body}}`, `{{steps.<id>.output}}` and `{{vars.KEY}}`. A condition such as `{{steps.qualify.output.score}} >= 80` has a true path and a false path. Without a workflow, a run is a single agent step.

## Usage and billing

**Connect, Usage** shows executions, AI tokens, tool and API calls, workflow executions, compute and storage for the billing period. Your project spend limit applies to agent runs like any other resource.
