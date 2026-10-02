# Progrid Connect: backend design

Progrid Connect lets a team build AI agents, give them tools, wire them into workflows, test them and deploy them behind an API. It is an automation platform, not a chat product. This document covers the backend in `apps/api/src/modules/connect`. Customer docs live in `apps/www/content/docs/connect.md`.

## Layers

The module is a stack. Each layer only knows the one below it.

1. **Models.** `models/catalog.ts` lists the models (ids, labels, effort support, list prices). `models/provider.ts` defines `ModelProvider`. `AnthropicProvider` calls Claude through the official SDK. `FakeProvider` is deterministic and runs every test and every local setup without a key. `ModelService` picks one from config.
2. **Agents.** Name, instructions, model, effort, variables, limits. Immutable versions (`ConnectAgentVersion.snapshot`) pin what a deploy runs.
3. **Tools.** `tools/registry.service.ts` maps a tool kind to a `ToolExecutor`. Kinds: `http_request`, `webhook_out`, `database_query`, `send_email`, `notify`, `progrid`.
4. **Connections.** Credentials for APIs, databases, mail servers and outbound webhooks (`connections.service.ts`).
5. **Workflows.** A graph of nodes (trigger, agent, tool, condition, action, transform, end) run by `runtime/run.service.ts`.
6. **Progrid infrastructure.** The `progrid` tool reaches the team's servers, databases, buckets, apps and support through the existing services.

## Data model

Tables are prefixed `prgd_connect_` (migration `20261002100000_connect`).

| Table | What it holds |
|---|---|
| `prgd_connect_agents` | The draft agent. Soft deleted so runs and usage stay. |
| `prgd_connect_agent_versions` | Immutable snapshots: instructions, model, effort, variables, limits, tools, workflow. |
| `prgd_connect_tools` | Tools of an agent. `name` is the model facing name, unique per agent. |
| `prgd_connect_workflows` | One graph per agent, optional. |
| `prgd_connect_connections` | Config (plain) and a sealed secret blob, field names and hints. |
| `prgd_connect_variables` | Variable values, always sealed. Secret ones never reach the model. |
| `prgd_connect_webhooks` | Inbound webhooks. URL token stored as a sha256 hash. Optional sealed signing secret. |
| `prgd_connect_agent_keys` | Run API keys (`prgd_ca_...`), sha256 hashed like API tokens. |
| `prgd_connect_runs` | One execution: status, input, output, error, token usage, cost, resume state. |
| `prgd_connect_run_steps` | The timeline: node, model, tool, condition and approval steps with timing. |

Runs are indexed by agent and time, team and time, team, status and time, status and time, and finish time (metering).

**Retention.** Every step field (`input`, `output`, `error`) is capped at 64 KB when it is written. A larger value is replaced by `{truncated, originalBytes, preview}`. The final run output is capped at 256 KB. The resume state is cleared when a run finishes. There is no automatic deletion of old runs yet; `storageBytes` on the usage page counts what is kept, so it can be billed or pruned later.

## Runtime

A run executes an `AgentSpec`: the deployed version's snapshot, or the live draft for test runs. The spec is frozen into the run's state when the run is created, so a deploy during a run changes nothing.

`RunService.walk` orders the graph topologically and executes each node whose incoming edge was activated. A condition activates only the edges whose `sourceHandle` matches its result (`"true"` or `"false"`). The first `end` node reached gives the run output. An agent without a workflow runs the implicit graph `trigger -> agent -> end`.

Node executors are a registry in `RunService` (`this.nodes`). Node data is checked by `NODE_TYPES` in `runtime/graph.ts`.

**Templates.** Strings may reference `{{trigger.*}}`, `{{steps.<nodeId>.output.*}}`, `{{vars.KEY}}` and, inside tool configs, `{{input.*}}`. A string that is a single reference keeps the value's type. Paths read own properties only, so `__proto__` and `constructor` resolve to nothing. There is no code execution.

**Conditions.** `runtime/expression.ts` is a small recursive descent parser: comparisons (`== != === !== > >= < <=`, `contains`), `&&`, `||`, `!` (also `and`, `or`, `not`), parentheses, numbers, strings, booleans and null. No `eval`, no `Function`, length and depth limits.

**The agent loop** (`runtime/agent-loop.ts`) is written by hand so every model call and tool call becomes its own step:

- `end_turn`: done. With an output schema the text must be JSON that matches it (`invalid_output` otherwise).
- `tool_use`: every `tool_use` block runs concurrently. All results go back in ONE user message. A failed tool is a `tool_result` with `is_error: true`.
- `pause_turn`: the assistant turn goes back unchanged and the loop calls again (at most 5 times).
- `refusal`: the run fails with `model_refused`; `stop_details` is kept on the model step.
- `max_tokens`: the run fails with `max_tokens`, keeping the partial text.

Tool inputs are parsed with JSON semantics and validated against the tool's input schema (ajv) before anything runs. A bad input is returned to the model as an error result.

**Limits.** `maxSteps` (every step counts), `maxTokensPerRun` (input, output and cache writes) and `timeoutSeconds` (per execution; time waiting for a person does not count). Bounds: steps 1 to 200, tokens 1,000 to 2,000,000, timeout 5 to 900 seconds. Per team caps come from config: agents, connections and concurrent runs.

**Cancellation.** `POST /runs/:id/cancel` marks the run. The walk checks before every step and stops. Open approvals of the run expire.

**Live events.** Steps and status changes are published on Redis (`connect:run:<id>`), so the SSE endpoint in any API replica sees steps written by the worker.

**Async runs, webhooks and schedules** run on the Temporal worker: `connectRunWorkflow` (one activity per run, never retried, since a run is checkpointed and claimed atomically) and `connectScheduleWorkflow`, started with a `cronSchedule` when an agent whose deployed workflow has a schedule trigger is deployed, and terminated on pause, redeploy and delete. When Temporal cannot be reached, a run executes in the API process.

## Claude

`AnthropicProvider` sends one non streaming `client.beta.messages.create` per loop step:

- `thinking` is never sent. Opus 5.5 and Sonnet 5.5 think adaptively and refuse a disabled or budgeted thinking config.
- `output_config.effort` is always set from the agent's effort (Opus 5.5 would otherwise default to medium). Haiku 4.5 gets neither effort nor thinking.
- `tool_choice` is always `auto` (forced choice is a 400 on Opus 5.5 and Sonnet 5.5). Tools whose schema allows it (every object has `additionalProperties: false` and `required`, no unsupported keywords) are sent with `strict: true`.
- Structured output (agent nodes with an output schema, Build with AI) uses `output_config.format: {type: "json_schema", schema}`.
- Prompt caching: the system prompt is two blocks, the stable platform preamble (`runtime/prompt.ts`) and the agent's instructions, with `cache_control` on the last one. Tools render before it, sorted by name. Top level automatic caching covers the growing conversation. No timestamps or ids go before the breakpoint. Secret variables render as `[secret NAME]` in prompts.
- Refusal fallbacks: on models that support them, `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"` (`CONNECT_MODEL_FALLBACKS`, on by default). After a fallback, blocks before the last `fallback` marker are echoed back only when they are text, as the fallback rules require. The model that answered is recorded on each model step.
- Assistant content is passed back exactly as returned, thinking blocks included.
- The SDK retries 429 and 5xx with backoff (`maxRetries: 3`). Typed errors map to run codes: `model_rate_limited`, `model_auth_failed`, `model_bad_request`, `model_timeout`, `model_unavailable`, `model_error`.
- `max_tokens` is `CONNECT_MAX_OUTPUT_TOKENS` (16,000 by default), sized for thinking plus the answer.

Usage per model step (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and `cache_creation.ephemeral_1h_input_tokens` for one hour writes) is recorded on the step and summed on the run, in total and per model (`modelUsage`).

Fast mode and server tools are never sent: they cost more than Connect's prices (see Billing and pricing).

## Security model

- **Secrets.** Connection credentials and every variable value are sealed with `common/crypto/secretbox` (AES 256 GCM, key from `SECRETS_KEY`). They are decrypted only inside tool executors and connection tests. Responses carry field names and hints (`••••abcd`). Audit events carry field names, never values. Config fields that look like secrets are refused.
- **Never to the model.** Secret variables are rendered only in tool mode (requests to an API, a database, a mail server). Every tool result, step payload and error passes a redactor that removes known secret values and their base64 and URL encoded forms.
- **Prompt injection.** The preamble tells the model that tool results, webhook payloads and anything in `<untrusted_input>` are data. Webhook payloads are wrapped in that tag. Destructive actions never run from model output alone: they wait for a person (below).
- **Approvals.** A tool with `requiresApproval`, and every mutating Progrid action (`server_power`), parks the run in `waiting_approval` and files an approval (`connect:tool_call`) in the existing approvals queue. Owners and admins approve or deny. Approving runs the call as the run's identity and re-dispatches the run, which skips every finished node. Denying fails the run with `approval_denied`. Approvals that expire fail the run with `approval_expired` (job every five minutes).
- **Identity.** A run acts as the agent's creator inside the team, limited to the agent's project. If the creator left, it acts as a team owner.
- **Permissions.** New scopes `connect:read` and `connect:write`. Owners and admins hold both; members hold `connect:read` only; readonly users hold `connect:read`. Test runs, deploys, keys, connections and variables need `connect:write`.
- **Audit.** Every create, update, delete, deploy, pause, key, webhook, variable and connection change emits an event (`connect.*`) into the audit log.

## Outbound network guard (SSRF)

`net/guard.ts` guards every tool that reaches a customer supplied address.

- Only `http` and `https`. No credentials in the URL.
- The host is resolved and **every** address must be public. Blocked: `0.0.0.0/8`, `10.0.0.0/8` (including the platform's `10.9.0.0/24` WireGuard network and the management ranges), `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (including the `169.254.169.254` metadata service), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, multicast and reserved space, `::`, `::1`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, `2001:db8::/32`, `100::/64`, and IPv4 mapped and NAT64 forms of all of these. `localhost`, `*.localhost`, `*.local` and `*.internal` are refused by name.
- The check runs inside the socket's DNS lookup, so the address that was checked is the address that is connected to. There is no rebinding window.
- IP literals are checked directly (Node skips the lookup for them).
- Redirects are followed by hand, at most 3, and every hop is checked again, including the connection's `allowedHosts`. `Authorization` and cookies are dropped when a redirect changes host.
- Timeout 15 seconds. Responses are capped at 1 MB; the model sees at most 20,000 characters.
- `CONNECT_NETWORK_ALLOWLIST` (admin only) opens specific CIDRs or host names. It is empty in production.

Database and SMTP hosts pass the same check and are then connected to by the checked IP, with the original name kept for TLS. The exception is a Progrid managed database of the same team (matched by its address). MongoDB `mongodb+srv` hosts are checked through their SRV records before connecting, but the driver resolves again, so that path is best effort.

## Read only databases

`database_query` is read only unless the connection says `readOnly: false`. Two layers:

1. **Parser** (`tools/sql-guard.ts`): one statement only; the first word must be a read (`SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE`, `VALUES`, `TABLE`); write words anywhere outside strings and comments are refused (this catches data modifying CTEs and `EXPLAIN ANALYZE`); `SELECT INTO`, `FOR UPDATE`, MySQL executable comments and dangerous functions (`pg_read_file`, `dblink`, `pg_sleep`, `set_config`, `load_file`, and more) are refused. With `allowedTables`, the tables after `FROM`, `JOIN`, `INTO`, `UPDATE` and in comma lists must be listed (plain or schema qualified, quoted or not; CTE names are fine). System catalogs and functions in `FROM` are refused then.
2. **Database**: PostgreSQL runs `BEGIN READ ONLY` with `SET LOCAL statement_timeout = 10000`, then rolls back. MySQL runs `START TRANSACTION READ ONLY` with `MAX_EXECUTION_TIME` (or MariaDB's `max_statement_time`). A write that slips past the parser fails here.

MongoDB allows only `find`, `aggregate` and `countDocuments`, refuses `$out`, `$merge`, `$where`, `$function` and `$accumulator`, and checks `allowedCollections` for the queried collection and every `$lookup`, `$graphLookup` and `$unionWith` source. `maxTimeMS` is 10 seconds.

Results are cut at `maxRows` (default 200, max 1,000) and shrunk further to fit 20,000 characters for the model. Connect timeouts are 10 seconds.

**Parser limits.** It does not follow views, functions, stored procedures or dynamic SQL. Use a database user with read only grants on just the tables the agent needs; the parser is a convenience, the grants are the boundary.

## Public API, keys and webhooks

- `POST /v1/connect/agents/:id/run` takes an agent key (`prgd_ca_...`, only for its own agent) or a team token with `connect:write`. Synchronous by default, waiting up to `CONNECT_SYNC_TIMEOUT_SECONDS` (60) and then answering 202. With `async: true` it answers 202 at once. `idempotencyKey` (body or `Idempotency-Key` header) maps to one run for 24 hours in Redis.
- Errors: 401 bad key, 404 unknown agent, 409 not deployed, 402 spend limit or payment required, 429 rate limits (per agent and per team per minute, and concurrent runs per team).
- Inbound webhooks: `POST /v1/connect/hooks/:hookId/:token`. The token is compared by hash in constant time. With signing on, `X-Prgd-Signature: t=<unix>,v1=<hex hmac>` over `<t>.<raw body>` is required within 5 minutes. Answers 202 with the run id.

## Billing and pricing

Connect is pay as you go. The owner approved launch prices, in riyals excluding 15% VAT:

| SKU | Price |
|---|---|
| `connect-executions` | SAR 0.04 per execution (agent run or workflow execution) |
| `connect-tool-calls` | SAR 0.02 per tool call |
| `connect-ai-*-tokens:<model>` | Anthropic list price plus 20%, at 3.75 SAR per USD, per model (table below) |

| Model, per 1M tokens | Input | Output | Cache read | Cache write (5 min) | Cache write (1 hour) |
|---|---|---|---|---|---|
| `claude-opus-5-5` | 18.00 | 90.00 | 0.90 | 22.50 | 36.00 |
| `claude-sonnet-5-5` | 9.00 | 45.00 | 0.90 | 11.25 | 18.00 |
| `claude-haiku-4-5` | 4.50 | 22.50 | 0.45 | 5.625 | 9.00 |

- **SKUs.** `connect-executions` and `connect-tool-calls`, priced per 1,000 (`unit` `per_1k`). AI tokens have five SKUs per model, `<base>:<model id>`: `connect-ai-input-tokens`, `connect-ai-output-tokens`, `connect-ai-cache-read-tokens`, `connect-ai-cache-write-tokens` (five minute writes, 1.25x input) and `connect-ai-cache-write-1h-tokens` (one hour writes, 2x input; Connect only sends five minute breakpoints today). Token prices are stored per 10M tokens (`unit` `per_10m`) so every price is a whole number of halalas (Haiku 4.5 cache writes are 5,625 halalas per 10M). The shapes, the math and the launch list live in `src/modules/connect/pricing.ts`; a unit test checks the launch list against the catalog's list prices.
- **Resource types**: `connect_execution`, `connect_tool_call`, `connect_ai_input`, `connect_ai_output`, `connect_ai_cache_read`, `connect_ai_cache_write`, `connect_ai_cache_write_1h`.
- **Seed.** `prisma/seed.ts` creates each launch price when its SKU has no current price, so a re-seed never overwrites a price staff set with `POST /admin/v1/prices` (the back office Finance page). An unpriced 0 row from the earlier seed (valid from the launch date) is closed and the launch price opens from that moment. The old model agnostic token SKUs are closed. `pricingConfigured` is true when any Connect price is above 0.
- **Per model usage.** Each run keeps `modelUsage`, tokens per billed model: `{"<model id>": {input, output, cacheRead, cacheWrite, cacheWrite1h}}`. Tokens go to the catalog model that answered (`billingModel`: a dated snapshot id maps to its catalog id). A response from a model outside the catalog, such as a server side refusal fallback to Claude Opus 5, is billed as the agent's model. The run's total token columns stay as before.
- **Metering.** `ConnectUsageService.meterHour` runs at seven past every hour. It sums the runs that finished in the previous hour and upserts one `UsageRecord` per SKU on the agent's project: executions and tool calls per agent (resourceId = agent id), tokens per agent and model (resourceId = `<agent id>:<model id>`, which keeps the unique `(resourceType, resourceId, hourStart)`). Invoices pick them up like any usage, with one line per token kind and model. Records already on an invoice are never changed.
- **Estimates.** The same math gives each run's `costEstimateMinor` (Test tab, run view, logs) and `estimatedCostMinor` on `GET /v1/connect/usage`, which also returns `byModel`. `GET /v1/connect/models` returns each model's `prices` per 1M tokens and the execution and tool call prices, in the team currency's minor units.
- **Not sold.** Opus fast mode (`speed: "fast"`) and Anthropic server tools (web search, web fetch, code execution) cost more than these prices. `AnthropicProvider` never sends them, and `assertPricedParams` refuses any request that carries them.
- **Plans later.** Monthly plans with included allowances can sit on top of this: they would subtract the allowance from the metered quantities before pricing, with the same SKUs.
- Before a run starts: the prepaid before postpaid check (`TrustService.assertPrepaidBeforePostpaid`, 402 `payment_required`) and the project spend limit (`SpendService.assertCanSpend`, 402 `spend_limit_reached`).
- Each run stores `costEstimateMinor` (price book estimate in the team currency, per model prices) and `providerCostMicroUsd` (tokens times the model's list price, per model step, using the model that actually answered). The second is the internal cost basis and is shown only in `GET /admin/v1/connect/overview` next to what was metered.
- Build with AI calls are rate limited (30 per team per hour) and logged with their token usage, but not metered.

## Extending

**Add a model.** Add an entry to `MODELS` in `models/catalog.ts` with its id, effort support, fallback support and list prices. Give it a price in `LAUNCH_TOKEN_SAR_PER_M` in `pricing.ts` (list price plus 20%) and run the seed, which creates its five token SKUs. Until then its tokens have no price. For a new vendor, write a class implementing `ModelProvider` (translate to and from the Messages API block shapes) and choose it in `ModelService`.

**Add a tool kind.** Write a `ToolExecutor` (config schema, connection kinds, default input schema, optional `needsApproval` and `summarize`, `execute`), register it in `ToolRegistry`, and add the kind to the `ConnectToolKind` enum (migration) and `TOOL_KINDS` in `kinds.ts`. Executors receive validated input and an opened connection; anything that reaches the network goes through `net/guard.ts`.

**Add a node type.** Add its data check to `NODE_TYPES` in `runtime/graph.ts` and its executor to `this.nodes` in `RunService`. Add it to the draft schema enum in `builder.ts` and to the OpenAPI `ConnectGraph` enum.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Claude API key. Empty runs the fake model. |
| `CONNECT_MODEL_PROVIDER` | auto | `anthropic` or `fake`. |
| `CONNECT_DEFAULT_MODEL` | `claude-opus-5-5` | Model for new agents and Build with AI. |
| `CONNECT_MODEL_FALLBACKS` | `true` | Server side refusal fallbacks. |
| `CONNECT_MAX_OUTPUT_TOKENS` | 16000 | Output cap per model call. |
| `CONNECT_PUBLIC_BASE_URL` | `PUBLIC_API_URL` | Base for run endpoints and webhook URLs. |
| `CONNECT_MAX_AGENTS_PER_TEAM` | 50 | |
| `CONNECT_MAX_CONNECTIONS_PER_TEAM` | 50 | |
| `CONNECT_MAX_CONCURRENT_RUNS` | 10 | Per team. |
| `CONNECT_RUNS_PER_MINUTE_PER_AGENT` | 60 | Public run API and webhooks. |
| `CONNECT_RUNS_PER_MINUTE_PER_TEAM` | 300 | |
| `CONNECT_PLATFORM_EMAILS_PER_HOUR` | 50 | Platform mail per team. |
| `CONNECT_NETWORK_ALLOWLIST` | empty | Admin only private ranges or hosts. |
| `CONNECT_SYNC_TIMEOUT_SECONDS` | 60 | Wait of a synchronous public run. |

In Ansible the key comes from `vault_anthropic_api_key` in `vault.yml`.

**Local end to end testing.** With `CONNECT_MODEL_PROVIDER=fake`, a whole agent (tools, workflow, approvals, public API, webhooks) runs without a key. To point a REST connection at a test server on the same machine, start the API with `CONNECT_NETWORK_ALLOWLIST=127.0.0.1/32` and use `http://127.0.0.1:<port>` as the base URL (the name `localhost` stays refused). Never set this in production.

## Back office

`GET /admin/v1/connect/overview?period=YYYY-MM` (staff with the finance or support area): totals, per team runs, failures, error rate, tokens, internal cost in dollars and metered amount in dollars, and the 20 busiest agents. It follows the existing back office prefix `/admin/v1` rather than `/admin/connect`.

## Contract changes

Differences from the shared contract (`connect-contract.md`), all additive unless noted:

1. **Webhook URL.** The URL token is stored hashed, so the full `url` is returned only by create and rotate (together with `token`, and `signingSecret` when signing is on). Afterwards `url` ends in `{token}`. `secretHint` hints the URL token.
2. **Agent extras.** Agents also carry `templateSlug` and `projectId`. `GET /agents/:id` adds `issues: string[]` (what blocks a deploy).
3. **Variables.** Non secret variables return `value`; secret ones only `hasValue`. A variable must be defined (PATCH `variables`) before `PUT .../variables/:key`. An empty value clears it.
4. **Runs.** Runs also carry `workflow`, `createdAt` and `agentName`. A waiting run carries `pendingApprovals[]`. Runs that fail with details get a final `Run failed` step.
5. **Models.** `GET /models` items carry `label`, `description`, `default`, `provider`, `efforts`, `contextWindow`, `available` and `prices` (per 1M tokens, minor units of the team currency); the list has `provider` (`anthropic` or `fake`) and `pricing {currency, configured, executionMinor, toolCallMinor}`.
6. **Build with AI.** `POST /agents/generate` returns `{draft, issues, model, usage}`. Draft tools name connections by `connectionRef`, and workflow nodes name tools by tool name. `POST /agents/from-draft` accepts an optional `connections` map from a `connectionsNeeded` ref (or name) to a connection id. `connectionsNeeded` items are `{ref, kind, name, reason, usedBy}`.
7. **Tools.** `POST .../tools/:toolId/test` answers `{ok, output, durationMs, error}`; calls that need approval are refused there and run only inside a run.
8. **Workflow.** `PUT .../workflow` with an empty graph (`nodes: []`) removes the workflow. `GET` answers `null` when there is none.
9. **Cross agent lists** (console request): `GET /v1/connect/webhooks` and `GET /v1/connect/keys` with `agentId` and `agentName`.
10. **Overview** (console request): adds `counts {connections, webhooks, keys, templates}`; `usageThisPeriod` is `{executions, aiInputTokens, aiOutputTokens, estimatedCostMinor, currency, pricingConfigured}`.
11. **Usage**: `byAgent` items are `{agentId, agentName, executions, aiInputTokens, aiOutputTokens, toolCalls, estimatedCostMinor}` plus `failed`, `aiCacheReadTokens`, `apiCalls`, `deleted`; `byDay` items are `{date, executions, aiInputTokens, aiOutputTokens}` plus `failed`, `aiCacheReadTokens`, `aiCacheWriteTokens`, `toolCalls`. Totals add `aiCacheWriteTokens`; the response adds `byModel[]` and `prices[]`.
12. **SSE** (console request): `GET /runs/:runId/events` authenticates with the `Authorization` header (or the console session cookie); there is no query string token. Events: `step` (RunStep), `run` (full Run on each status change), final `end`; a heartbeat comment every 15 seconds.
13. **Async test runs** (console request): `POST /agents/:id/test` with `async: true` returns the queued run at once.
14. **Filters**: `GET /logs` takes `source`; `GET /agents/:id/runs` takes `from` and `to`.
15. **Connections.** Secret field names: `token`, `username`, `password`, `value` (rest_api, by auth type), `password` (postgres, mysql, smtp), `password` or `uri` (mongodb), `signingSecret` (webhook_out). PATCH `secrets` with `null` removes a field. Test answers `{ok, status, error, durationMs, testedAt}`. Deleting a connection that tools use is refused (409 `connection_in_use`).
16. **Public run.** A sync run still going after 60 seconds answers 202 `{runId, status, statusUrl}`. Responses add `error`. The public run status endpoint is `GET /v1/connect/agents/:id/runs/:runId`.
17. **Admin path.** The back office overview is `GET /admin/v1/connect/overview`, following the existing `/admin/v1` prefix.
18. **Deploy** without a version snapshots the draft as a new version (note `Deployed`) and refuses with 409 `agent_incomplete` while tools miss connections or required variables have no value.
