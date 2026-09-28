# Managed cloud operations

How the managed cloud service runs inside Progrid: roles, contracts, on call and paging, SLA timers, Alertmanager, heartbeats, maintenance runs, billing and monthly reports. The customer facing description is in `apps/www/content/docs/managed-cloud.md`.

The code lives in `apps/api/src/modules/managed` (one folder per area) and the Temporal workflows in `apps/api/src/workflows/managed`. Customer endpoints are under `/v1/managed`, staff endpoints under `/admin/managed`, and the monitoring receivers under `/internal`.

## Roles

Staff access uses the existing back office roles. Grant them with `POST /admin/v1/staff/{userId}` and a body like `{"isStaff": true, "staffRoles": ["engineer"]}`. Staff need two factor sign in before any back office call.

| Role | Can do |
|---|---|
| `engineer` | Read contracts, assets, alerts and pages; work tickets (reply, internal notes, status, priority, assign to self); tick onboarding items; approve or reject assets and rotate heartbeat tokens; log time; manage maintenance tasks and run them; edit runbooks; edit and send monthly reports |
| `support_lead` | Everything an engineer can, plus: create contracts for a team, activate, suspend, resume, cancel and renew contracts; add, edit and remove assets and toggle monitoring and backups; edit the responsibility matrix; assign tickets to anyone; manage on call shifts and other people's paging contacts; log time for others; edit the holiday calendar |
| Full staff (no roles) | Everything, including creating and pricing plans |

On the customer side, team owners request plans, read contracts and reports, and request assets. Members (and admins) can open and read tickets and see assets. The scopes are `managed:read` and `managed:write`.

## Contract lifecycle

`DRAFT` to `ONBOARDING` to `ACTIVE`, then `SUSPENDED` and `CANCELLED`. Every change emits a `managed.*` event, which writes the audit log.

1. **DRAFT.** Created by a customer owner (`POST /v1/managed/contracts`) or by a support lead for a team (`POST /admin/managed/contracts`). The default responsibility matrix is created with it. The staff inbox (`SUPPORT_INBOX`) gets an email. Enterprise plans have no list price: set `priceOverrideMinor` (and usually `includedMinutesOverride` and `maxAssetsOverride`) with `PATCH /admin/managed/contracts/{id}` before activating.
2. **ONBOARDING.** `POST /admin/managed/contracts/{id}/activate` with `liabilityCapMinor` and `signedByName` (and `signedAt` when the signature was earlier). It records the signing lead, creates the onboarding checklist and starts the `managedOnboarding` workflow.
3. **ACTIVE.** Ticking the last checklist item signals the workflow, which moves the contract to ACTIVE, sets `activatedAt` (billing starts) and `termEndsAt`, and emails the owners. If the signal cannot be delivered, the API runs the same check inline.
4. **SUSPENDED.** `POST .../suspend`. An hourly job also suspends contracts of teams that dunning suspended, and resumes them when the team is reinstated (only contracts the job suspended). Monitoring and alerts continue; tickets, SLA timers, paging and maintenance stop; no fee accrues.
5. **CANCELLED.** `POST .../cancel`. Billing stops that day. The access revocation hook disables maintenance tasks and monitoring, clears heartbeat tokens and resolves open alerts, then the owners get the handover document by email (`GET .../handover` shows it).

`POST .../resume` returns a suspended contract to ACTIVE (or ONBOARDING if it never went live). `POST .../renew` extends the term by `termMonths`.

### Access revocation checklist

The hook stops everything the platform does. Removing our access from external servers is still a manual step: the `managed.access_revoked` event lists the assets with their management addresses. For each one, remove the `prgd` SSH user or its key, remove the server's WireGuard peer from the management network, and uninstall the monitoring agent if the customer asks.

## Onboarding

The default checklist is: monitoring, backups (with a tested restore), access through the management network, documentation and runbook, and the responsibility matrix. `GET /admin/managed/contracts/{id}/onboarding` shows each item with a `check` computed from the data: monitoring on and a heartbeat received from every external server, backups on and a successful `BACKUP_TEST` run, a management address on every external server, a runbook tagged `contract:<id>`, and a non empty matrix. The checks are advice; the engineer ticks the item with `PATCH .../onboarding/{key}` and `{"done": true}`. Support leads can add items with `POST .../onboarding`.

## On call

Shifts have a role, `PRIMARY` or `SECONDARY`, and a time window (`/admin/managed/oncall/shifts`). `GET /admin/managed/oncall/current` shows who is on call now.

**Two person rule.** A 24/7 plan (BUSINESS, ENTERPRISE) can only be activated when at least two different staff members have shifts in the next 14 days. Otherwise activation answers `409 on_call_rule`. A support lead can pass `"overrideOnCallRule": true`; the contract records `onCallOverride` and the audit log gets `managed.on_call_rule_overridden`. Do not sell a 24/7 plan until the rota really has two people.

**External engineers.** Active engineer profiles from the DevOps console can hold shifts too. Paging and automatic ticket assignment only pick someone who may work on the contract: an external engineer must be assigned to it, and everyone must satisfy the contract's residency policy (`accessPolicy`). Otherwise the secondary, or the support lead, is paged instead. See `docs/devops-console.md`.

**Who gets paged.** P1 and P2 tickets, from customers or from critical alerts, page the current primary with high urgency. If nobody acknowledges within `PAGE_ACK_TIMEOUT_SECONDS` (600, ten minutes), the `managedPageEscalation` workflow pages the support lead: the current secondary if one is on shift, otherwise the longest serving staff member with the `support_lead` role. When nobody is on call at all, the page goes straight to the support lead.

**Acknowledging.** `POST /admin/managed/pages/{id}/ack` acknowledges a page and every other open page about the same alert or ticket. `POST /admin/managed/alerts/{id}/ack` acknowledges the alert and its pages. `GET /admin/managed/pages?open=true&mine=true` lists your open pages.

**Contacts.** Each staff member sets a phone number (E.164) and a preferred channel with `PUT /admin/managed/staff/{userId}/contact`. Support leads can set anyone's.

## Paging providers

| Setting | Meaning |
|---|---|
| `PAGING_MODE=log` | Default. Pages are recorded (`Page` rows, provider `log`) and logged, never sent. |
| `PAGING_MODE=live` | Pages go out through the channel adapters below. |

High urgency pages use the person's `pagingChannel`, or SMS when they have a phone, or email. Low urgency pages (SLA warnings) use push when `PUSH_WEBHOOK_URL` is set, otherwise email. A channel that is not configured, or a person without a phone, falls back to email, and a failed SMS is followed by an email.

| Adapter | Configuration |
|---|---|
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (vault `vault_twilio_auth_token`), `TWILIO_FROM` |
| Twilio WhatsApp | the same account and `TWILIO_WHATSAPP_FROM`; the sender must be approved for WhatsApp in Twilio |
| Push webhook | `PUSH_WEBHOOK_URL` receives `POST {pageId, userId, email, urgency, title, message, url}` |
| Email | the normal mail provider |

## SLA timers

Due times come from the plan's `responseTargets` and `resolveTargets` (minutes per priority) and the contract calendar. Business hours plans count 09:00 to 17:00 on working days (Sunday to Thursday in Asia/Riyadh for `SA`, Monday to Friday in Europe/Istanbul for `TR`) and skip the `Holiday` table. The calculator is `modules/managed/sla/sla-calculator.ts`.

**P1 postmortems.** Closing a P1 moves it to `resolved_pending_pm` until its postmortem is submitted in the DevOps console. Customers see it as closed, and the resolve timer stops at the resolution.

Each ticket gets two `managedSlaTimer` workflows, one for the response target and one for the resolve target. At 75 percent of the target the assignee (or the primary on call) gets an email and a low urgency page and `warnedAt` is set. At 100 percent `breachedAt` and `responseBreached` or `resolveBreached` are set and the support lead is paged and emailed. The response timer ends at the first public staff reply; the resolve timer ends when the ticket is closed. Internal notes do not count as a response. Changing the priority recomputes the due times from the opening time and starts new timers.

**Holidays.** The seed loads Saudi and Turkish public holidays for 2026 and 2027. Eid dates follow the Hijri calendar and the 2027 ones are estimates: every year, once the official dates are announced, check them with `GET /admin/managed/holidays?country=SA&year=2027` and fix them with `PUT /admin/managed/holidays` (`{country, date, name}`) or `DELETE /admin/managed/holidays/{id}`.

## Alertmanager

Point an Alertmanager receiver at the API. The shared secret is `ALERTMANAGER_WEBHOOK_SECRET` (vault `vault_alertmanager_webhook_secret`); it is accepted as a Bearer token or as the `X-Prgd-Webhook-Secret` header and refused in a query string.

```yaml
# alertmanager.yml
route:
  receiver: prgd-managed
  group_by: [alertname, asset_id]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: prgd-managed
    webhook_configs:
      - url: https://api.progrid.sa/internal/alerts/alertmanager
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials_file: /etc/alertmanager/prgd-webhook-secret
```

Every alert needs two labels:

| Label | Value |
|---|---|
| `asset_id` | the managed asset id (shown on the asset in the back office) |
| `severity` | `critical` opens a P1 ticket and pages the on call engineer; `warning` opens a P3 ticket without a page; anything else is recorded as INFO |

Add `asset_id` in the scrape config so every series carries it, for example:

```yaml
scrape_configs:
  - job_name: managed-node
    static_configs:
      - targets: ["10.8.0.5:9100"]
        labels: { asset_id: "cm1abc...", customer: "acme" }
```

Alerts are deduplicated by the Alertmanager fingerprint while open, so repeated deliveries update the same alert. A resolved notification closes the alert and adds a note to its ticket; the engineer closes the ticket after writing down the root cause. Alerts for unknown assets, assets with monitoring off, and cancelled or draft contracts are ignored (counted in the `ignored` field of the response). Suspended contracts keep their alerts but get no tickets or pages.

## Heartbeats from external servers

External servers run a small agent (or a cron job) that posts a heartbeat every minute:

```sh
curl -fsS -X POST https://api.progrid.sa/internal/agents/heartbeat \
  -H "Authorization: Bearer $PRGD_HEARTBEAT_TOKEN" -H "content-type: application/json" \
  -d "{\"status\":\"ok\",\"hostname\":\"$(hostname)\",\"uptimeSeconds\":$(cut -d. -f1 /proc/uptime)}"
```

`status` is `ok`, `degraded` or `critical` and sets the asset's health. Issue or rotate the token with `POST /admin/managed/assets/{id}/heartbeat-token`; it is shown once and only its hash is stored. A job runs every minute: an external server silent for `MANAGED_HEARTBEAT_STALE_MINUTES` (10) is marked UNHEALTHY and raises a critical `HeartbeatMissing` alert (P1 ticket and page). The next heartbeat resolves it.

## Maintenance

Tasks (`/admin/managed/maintenance/tasks`) run a playbook on a five field cron schedule in the task's time zone (the contract calendar's zone by default), against one asset or every approved server of the contract that has a management address. `PATCHING` uses `patching.yml` and `BACKUP_TEST` uses `backup-test.yml` unless another playbook is named; `CUSTOM` needs one. `vars` are passed to the playbook. A job starts due runs every minute; `POST .../tasks/{id}/run` runs one now. Suspended contracts skip their runs.

Each run is a `managedMaintenanceRun` workflow. The status and log are stored on the `MaintenanceRun` (`GET /admin/managed/maintenance/runs/{id}`). A failed run opens a P3 ticket assigned to the primary on call, with the end of the log as an internal note.

**Runners.** `MAINTENANCE_RUNNER=fake` (the default) touches nothing and writes a log shaped like an Ansible run; `"simulateFailure": true` in the task vars makes it fail. `MAINTENANCE_RUNNER=ansible` runs `ansible-playbook` on the worker:

1. The worker image needs `ansible-core` and an SSH client. The standard image does not include them yet: build a worker image with them before switching the runner.
2. Playbooks come from `MAINTENANCE_PLAYBOOK_DIR`. In production Ansible copies `infra/ansible/maintenance` to `/opt/prgd/maintenance`, which the compose file mounts read only into the worker.
3. The inventory is written per run with each asset's management address (WireGuard or private IP) and `ansible_user=MAINTENANCE_SSH_USER`. Put the private key at `MAINTENANCE_SSH_KEY_FILE` (or use an SSH agent) and make sure the worker can reach the management network.
4. Runs are killed after `MAINTENANCE_TIMEOUT_MINUTES` (60).

`patching.yml` upgrades Debian and Ubuntu with apt and RHEL family systems with dnf, and reboots when the system says a reboot is required. `backup-test.yml` is a documented starting point for restic: it checks that the newest snapshot is recent and restores a test file; adapt the marked tasks to each customer's backup tool.

## Engineer time and billing

Log time with `POST /admin/managed/worklogs` (`contractId`, `minutes`, optional `ticketId`, `billable`, `note`, `workedAt`). Engineers edit their own entries, support leads anyone's. Entries logged here are APPROVED at once. Engineers in the DevOps console log time with timers instead; their worklogs start as DRAFT and count only once a support lead approves them (see `docs/devops-console.md`). Only APPROVED (and PAID) worklogs count for overage, the usage view and the reports; the usage view also shows `pendingApprovalMinutes`. `GET /admin/managed/contracts/{id}/usage?period=2026-09` shows the included, used and overage minutes and any managed lines already accrued.

At 00:30 UTC on the 1st, before the invoice run, the billing hook writes two usage records per contract on the team's oldest project:

1. `managed_plan`: the monthly fee times the share of the month the contract was active. The first month counts from activation, suspensions are skipped, and a cancelled contract is billed up to its cancellation date.
2. `managed_overage`: approved billable minutes beyond the included minutes, at the hourly rate (250 SAR by default).

Amounts are in the team's invoice currency; the invoice adds VAT. The worklogs counted get `billedPeriod`, and the invoice run stamps them with `billedInvoiceId`. A counted entry can no longer be edited; log a correcting entry instead. Entries logged late for a closed month are counted in the next run.

## Monthly reports

At 04:00 UTC on the 1st a job starts `managedMonthlyReport` for every ACTIVE contract. It drafts the report for the previous month: uptime per asset, incidents, SLA met and breached, patch windows, backup tests, hours used and suggested recommendations, with a PDF in the invoice style.

Engineers review the drafts (`GET /admin/managed/reports?status=DRAFT`), rewrite the recommendations (`PATCH /admin/managed/reports/{id}`, the PDF is re-rendered) and send them (`POST .../send`), which emails the PDF to the team owners. A draft still unsent at 06:00 UTC on `MANAGED_REPORT_AUTOSEND_DAY` (the 3rd) is sent automatically by the workflow; a daily job at 06:20 UTC does the same as a safety net. `POST /admin/managed/reports/{contractId}/generate` with an optional `period` regenerates a report; it keeps the recommendations and the sent state.

**Uptime method.** For each approved asset the observed window runs from its approval (or the start of the month) to its removal (or the end of the month, or now). Downtime is the union of the critical alerts on the asset in that window, including `HeartbeatMissing`, with open alerts counted up to the end of the window. Uptime is one minus downtime over observed time. The contract figure weights the assets by observed time.

## Staff endpoints

| Area | Endpoints |
|---|---|
| Plans | `GET, POST /admin/managed/plans`, `GET, PATCH, DELETE /admin/managed/plans/{id}` (changes are full staff only) |
| Teams | `GET /admin/managed/teams?q=` (support leads and full staff: id, name, slug, country and owner name, no billing data) |
| Contracts | `GET, POST /admin/managed/contracts`, `GET, PATCH /admin/managed/contracts/{id}`, `POST .../activate`, `.../suspend`, `.../resume`, `.../cancel`, `.../renew`, `GET .../handover`, `GET .../usage` |
| Onboarding | `GET, POST /admin/managed/contracts/{id}/onboarding`, `PATCH .../onboarding/{key}` |
| Responsibilities | `GET, POST /admin/managed/contracts/{id}/responsibilities`, `PATCH, DELETE .../responsibilities/{rid}` |
| Assets | `GET, POST /admin/managed/contracts/{id}/assets`, `GET, PATCH, DELETE /admin/managed/assets/{id}`, `POST .../approve`, `.../reject`, `.../heartbeat-token` |
| Tickets | `GET /admin/managed/tickets`, `GET, PATCH /admin/managed/tickets/{id}`, `POST .../messages` (`internal: true` for a note) |
| Alerts | `GET /admin/managed/alerts`, `GET, PATCH /admin/managed/alerts/{id}`, `POST .../ack` |
| On call | `GET /admin/managed/oncall/current`, `GET, POST /admin/managed/oncall/shifts`, `PATCH, DELETE .../shifts/{id}`, `GET /admin/managed/staff`, `PUT /admin/managed/staff/{userId}/contact` |
| Pages | `GET /admin/managed/pages`, `POST /admin/managed/pages/{id}/ack` |
| Maintenance | `GET, POST /admin/managed/maintenance/tasks`, `GET, PATCH, DELETE .../tasks/{id}`, `POST .../tasks/{id}/run`, `GET /admin/managed/maintenance/runs`, `GET .../runs/{id}` |
| Worklogs | `GET, POST /admin/managed/worklogs`, `PATCH, DELETE /admin/managed/worklogs/{id}`. The list carries `totals` for the whole filter: overall, `byContract` (team, plan, included and overage minutes) and `byUser` |
| Runbooks | `GET, POST /admin/managed/runbooks`, `GET, PATCH, DELETE /admin/managed/runbooks/{idOrSlug}` |
| Reports | `GET /admin/managed/reports` (reports and maintenance tasks and runs carry `teamName` and `planName`), `GET, PATCH /admin/managed/reports/{id}`, `GET .../pdf`, `POST .../send`, `POST /admin/managed/reports/{contractId}/generate` |
| Holidays | `GET, PUT /admin/managed/holidays`, `DELETE /admin/managed/holidays/{id}` |

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `ALERTMANAGER_WEBHOOK_SECRET` | empty (refuses every call) | Shared secret for `/internal/alerts/alertmanager` |
| `PAGING_MODE` | `log` | `live` sends pages |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_WHATSAPP_FROM` | empty | Twilio SMS and WhatsApp |
| `PUSH_WEBHOOK_URL` | empty | Push relay |
| `PAGE_ACK_TIMEOUT_SECONDS` | 600 | Escalation to the support lead |
| `MANAGED_HEARTBEAT_STALE_MINUTES` | 10 | Silent external servers raise an alert |
| `MAINTENANCE_RUNNER` | `fake` | `ansible` runs playbooks |
| `MAINTENANCE_PLAYBOOK_DIR` | `infra/ansible/maintenance` | `/opt/prgd/maintenance` in production |
| `MAINTENANCE_SSH_USER`, `MAINTENANCE_SSH_KEY_FILE` | `prgd`, empty | SSH for the Ansible runner |
| `MAINTENANCE_TIMEOUT_MINUTES` | 60 | Longest run |
| `MANAGED_REPORT_AUTOSEND_DAY` | 3 | Unsent drafts go out on this day |

The staff inbox for new requests, assets to approve and new tickets is `SUPPORT_INBOX`.
