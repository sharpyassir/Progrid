# DevOps console

The DevOps console is where on call engineers operate managed cloud contracts: external,
hourly paid contractors (in Jordan or India, for example) and Progrid's own engineers. It is a
separate app (`apps/ops`, served at `ops.progrid.co` and, for the same staff, at `ops.progrid.sa`) with its own API under `/ops/v1`, its own
session type and its own guards. The back office for it is under `/admin/ops`, and the terminal
gateway (`services/prgd-gateway`) talks to `/internal/gateway`.

The rule behind every design choice: an external engineer is an outsider with access to customer
servers. Access is narrow (assigned contracts only), time limited (per ticket or maintenance run),
fully recorded, and always goes through the platform, never directly from the engineer's machine.

The backend lives in `apps/api/src/modules/ops` (one folder per area) and the Temporal workflows in
`apps/api/src/workflows/ops`. Tickets, alerts, paging, SLA timers, maintenance runs, worklogs and
runbooks come from the managed cloud module (see `docs/managed-cloud-operations.md`); the ops
module calls its services instead of duplicating them.

## Roles

| Role | Who | Can do |
|---|---|---|
| External engineer | A user with an `EngineerProfile` of kind `EXTERNAL`. Never staff. | Only assigned contracts and their assets: work tickets, acknowledge alerts, request access, open terminal sessions on an active grant, run maintenance, log time, write runbooks, postmortems and handovers, see their own timesheet and payouts |
| Internal engineer | Staff with the `engineer` area (optionally an `INTERNAL` profile for country and time zone) | The same on every contract; no approvals |
| Support lead | Staff with the `support_lead` area | Also approve access grants and timesheets (never their own), assign engineers, watch and kill sessions, close postmortems; in the back office: engineers, assignments, grants, sessions, timesheets, postmortems |
| Full staff | Staff without areas | Everything, including engineer rates, payouts, contract residency policies and the ops settings |

External engineers can never see billing, pricing or invoices, see customer email addresses or
phone numbers, export data, grant themselves access, see raw secrets, or act on assets outside an
open ticket or maintenance run. They cannot sign in to the customer console
(`POST /v1/auth/login` answers `403 ops_console_only`) and cannot be made staff.

Create engineers with `POST /admin/ops/engineers`: pass `userId` to link an existing user
(internal engineers must be staff with the engineer or support_lead area), or `email` and `name`
to create an external engineer's account. The new user gets a mail with a link to
`PRGD_OPS_URL/set-password?token=...`; the ops console posts the token and the chosen password to
`POST /ops/v1/auth/password/reset`. Then assign contracts with
`POST /admin/ops/engineers/{id}/assignments` (`{contractId}`).

## Security model

**Sessions.** Ops sessions are rows in `prgd_sessions` with `audience = ops`, the second factor
used, the client address and user agent, and a twelve hour lifetime
(`PRGD_OPS_SESSION_TTL_SECONDS`). The token is an HS256 JWT with `aud: "ops"` and the session id
as `jti`; revoking the row ends it at once. The global auth guard sends every `/ops/` path to the
ops session resolver, which accepts nothing else: API tokens (`prgd_...`) and console sessions
answer 401 there, and an ops token answers 401 on `/v1` and `/admin`.

**Guards on every `/ops/v1` route** (except the sign in routes):

1. `EngineerGuard`: an ops session, and either an ACTIVE engineer profile or internal engineer
   staff whose profile (if any) is ACTIVE. The per engineer IP allowlist
   (`EngineerProfile.ipAllowlist`, CIDRs) is checked on every request (`403 ip_not_allowed`).
2. `AssignmentGuard`: every contract, asset, ticket, alert, maintenance task, maintenance run,
   access grant and page the request names (route parameters, and the `contractId`, `assetId`,
   `ticketId`, `alertId`, `taskId`, `maintenanceRunId`, `runId` and `grantId` fields of the body
   and query) must belong to a contract the engineer may see. Unknown and invisible objects both
   answer `404 not_found`, so nobody can probe other customers. Services filter every list the
   same way.
3. `ResidencyGuard`: on routes that act on servers (access grants, grant extension, terminal
   sessions, maintenance runs) every contract touched must allow the engineer's country.

**Residency.** `ManagedContract.accessPolicy` is `ANY`, `SAUDI_ONLY` or `TURKIYE_ONLY` (new
contracts take the `defaultAccessPolicy` setting, `ANY`). It is compared with
`EngineerProfile.country` (ISO 3166-1 alpha-2); internal staff without a profile count as `SA`.
It is enforced when a contract is assigned (`403 residency_blocked`), when tickets are assigned
and when the on call engineer is paged or auto assigned (someone ineligible is skipped: the
secondary, or the support lead, gets the page), and at every grant request, grant approval and
gateway session check. Changing a contract's policy (`PATCH /admin/ops/contracts/{id}/access-policy`,
full staff) removes the assignments it now excludes and revokes those engineers' grants.

**Data masking.** Everything `/ops/v1` returns goes through explicit mappers
(`modules/ops/serializers/ops-dto.ts`): no email address or phone number of anyone (people appear
as `{id, name}`), no billing, pricing or invoice fields, and for external engineers the text
customers wrote (ticket subjects and customer messages) has email addresses and phone numbers
replaced with `[email hidden]` and `[phone hidden]`. Internal notes are visible to engineers and
never to customers. The integration suite scans every ops response of an external engineer for
email addresses and phone numbers.

**Audit.** Every state change writes an `ops.*` event through `OpsAudit`: the audit log row has
the actor, the client address and user agent, the customer's team, and the payload names the
contract, asset and ticket (plus the grant, session, timer or payout).

## Signing in

A password alone never opens a session. All bodies are JSON; errors are
`{"error": {"code", "message", "details?"}}`.

1. `POST /ops/v1/auth/login` `{"email", "password"}` answers
   `{"challenge": "<jwt>", "expiresAt": "...", "methods": ["totp", "webauthn"], "enroll": false}`.
   The challenge lasts five minutes and opens one session only. `methods` lists the enrolled
   second factors; `enroll: true` means none yet. Inactive engineers get `403 engineer_inactive`,
   addresses outside the allowlist `403 ip_not_allowed`, other users `403 not_engineer`.
2. With TOTP: `POST /ops/v1/auth/totp` `{"challenge", "code"}` (a recovery code works too).
3. With a security key or passkey:
   `POST /ops/v1/auth/webauthn/authenticate/options` `{"challenge"}` answers
   `PublicKeyCredentialRequestOptionsJSON`; pass it to `startAuthentication()` of
   `@simplewebauthn/browser` and send the result to
   `POST /ops/v1/auth/webauthn/authenticate/verify` `{"challenge", "response"}`.
4. Enrolling the first factor (when `enroll` is true), with the same challenge:
   - TOTP: `POST /ops/v1/auth/totp/setup` `{"challenge"}` answers `{"secret", "otpauthUrl"}`
     (show a QR code); `POST /ops/v1/auth/totp/enable` `{"challenge", "code"}` answers
     `{"enabled": true, "recoveryCodes": [10 codes], ...session}`.
   - WebAuthn: `POST /ops/v1/auth/webauthn/register/options` `{"challenge"}` answers
     `PublicKeyCredentialCreationOptionsJSON` for `startRegistration()`;
     `POST /ops/v1/auth/webauthn/register/verify` `{"challenge", "response", "name"}` answers
     `{"credential": {...}, ...session}`.
   The same four calls without `challenge` and with the ops session as Bearer add more factors
   later. `GET /ops/v1/auth/credentials` lists them, `DELETE /ops/v1/auth/webauthn/credentials/{id}`
   removes a key (never the last factor).

   A challenge proves only the password, so enrolling from it is limited: it works once per
   engineer profile (`enrolledAt` is set and audited as `ops.second_factor_enrolled_from_password`,
   an alert for the support lead to review) and only within `ENROLL_WINDOW_HOURS` (72) of the
   profile being created, i.e. while the welcome mail's password link is the proof of identity.
   Later, or for internal staff without an engineer profile (who enroll TOTP in the console under
   Security), the setup calls answer `403 enrollment_closed`. Security keys must verify the user
   (PIN or biometric, `userVerification: required`).

   Five failed passwords or second factors in a row lock the account (console and ops console
   share it) for 15 minutes, doubling per repeated lockout up to 24 hours; a successful sign in
   resets it. Failures are audited as `ops.signin_failed` and `ops.second_factor_failed`. Ops
   sessions end after `OPS_SESSION_IDLE_MINUTES` (30) without a request.

Every successful second factor answers the session:

```json
{
  "session": "<ops session JWT>",
  "expiresAt": "2026-09-29T06:00:00.000Z",
  "user": { "id": "cm...", "name": "Rami Haddad", "locale": "en" },
  "engineer": { "kind": "EXTERNAL", "country": "JO", "timezone": "Asia/Amman" }
}
```

and sets the HttpOnly cookie `prgd_ops_session` (path `/ops`, SameSite Lax, Secure when
`PRGD_OPS_URL` is https). Send the session as `Authorization: Bearer <session>` on every call.
The cookie is accepted on GET requests only (the Server Sent Events log stream and PDF downloads,
where a browser cannot set headers); state changes always need the Bearer header, which keeps
cross site requests out. `POST /ops/v1/auth/logout` ends the session and clears the cookie.
`POST /ops/v1/auth/password/forgot` `{"email"}` mails engineers a reset link (always answers 200).

Passkeys are bound to one relying party. The primary ops console is `ops.progrid.co`: staff register and use passkeys there. A passkey registered on `ops.progrid.co` does not work on `ops.progrid.sa` and the other way round (the API picks `PRGD_OPS_URL_SA` and `PRGD_OPS_RP_ID_SA` for a browser on ops.progrid.sa). TOTP works on both. The WebAuthn relying party is `PRGD_OPS_RP_ID` (`ops.progrid.co`) and the expected origin is
`PRGD_OPS_URL`. A sign in from a user agent and address pair the engineer never used before
emails the support lead and sends them a low urgency page (`ops.signed_in` has `newDevice: true`).

## Engineer API (`/ops/v1`)

All routes need an ops session; "who" is external (E) and internal (I) engineers.

| Method and path | Who | What |
|---|---|---|
| `GET /me` | E, I | Profile, contracts, current shift, open pages, running timer, active grants, last handover |
| `GET /contracts` | E, I | Contracts the engineer may see (no billing fields) |
| `GET /alerts?status=open\|FIRING\|ACKNOWLEDGED\|RESOLVED\|all&contractId&assetId` | E, I | Alerts on assigned contracts |
| `POST /alerts/{id}/ack` | E, I | Acknowledge (stops the escalation) and take its ticket |
| `POST /pages/{id}/ack` | E, I | Acknowledge a page |
| `GET /tickets?mine=true&status=open\|answered\|closed\|resolved_pending_pm\|all&priority&contractId&assetId` | E, I | Tickets, most urgent SLA first (`slaSecondsLeft`) |
| `GET /tickets/{id}` | E, I | Ticket workspace (below) |
| `POST /tickets/{id}/messages` `{body, internal?}` | E, I | Public reply (emails the customer, counts as the response) or internal note |
| `PATCH /tickets/{id}` `{status?, priority?, assigneeId?, rootCause?}` | E, I | Closing needs a root cause note (`rootCause`, or one written before), else `422 root_cause_required`; engineers assign only themselves |
| `POST /tickets/{id}/escalate` `{reason}` | E, I | Pages the support lead (high urgency) and notes it on the ticket |
| `GET /assets/{id}` | E, I | Health, Grafana and Loki links, recent alerts, maintenance history, backup tests, open tickets, responsibility matrix |
| `POST /access/grants` `{assetId, ticketId \| maintenanceRunId, reason, durationMin}` | E, I | Request access (below) |
| `GET /access/grants?status=live\|REQUESTED\|...` | E, I | Own grants |
| `GET /access/grants/{id}` | E, I | One own grant |
| `POST /access/grants/{id}/extend` `{reason, minutes?}` | E, I | One extension (`409 extension_used` after) |
| `POST /sessions` `{grantId}` | E, I | Open a terminal session: one time gateway token and URL |
| `GET /sessions` | E, I | Own terminal sessions |
| `POST /timers/start` `{ticketId \| maintenanceRunId, note?}` | E, I | One running timer (`409 timer_running`) |
| `POST /timers/stop` `{note?, billable?}` | E, I | Stop: creates a DRAFT worklog |
| `GET /timers/current` | E, I | `{timer}` or `{timer: null}` |
| `POST /activity` `{ticketId?}` | E, I | Heartbeat while the engineer works (keeps the timer from going idle); send every minute or two |
| `GET /timesheet?month=2026-09` or `?week=2026-W39` | E, I | Own entries, totals by status, running timer |
| `POST /timesheet/entries` `{ticketId \| maintenanceRunId, minutes, startedAt, reason, note?, billable?}` | E, I | Manual entry (flagged for review) |
| `PATCH /timesheet/entries/{id}`, `DELETE /timesheet/entries/{id}` | E, I | Own DRAFT or REJECTED entries |
| `POST /timesheet/submit` `{month}` or `{week}` | E, I | DRAFT entries to SUBMITTED |
| `GET /shifts` | E, I | Own shifts (a week back, four ahead) and the checklist items |
| `POST /shifts/start` `{shiftId?, checklist}` | E, I | Start (below) |
| `POST /shifts/end` `{shiftId?, handover}` | E, I | End with a handover (below) |
| `GET /shifts/handover/latest` | E, I | The last handover; reading it is on the checklist |
| `GET /maintenance/tasks?contractId&assetId` | E, I | Tasks on assigned contracts |
| `POST /maintenance/tasks/{id}/run` | E, I | Run now (on the platform) |
| `GET /maintenance/runs?taskId&contractId&status`, `GET /maintenance/runs/{id}` | E, I | Runs, one run with its log |
| `POST /maintenance/runs/{id}/retry` | E, I | Start a failed run's task again (trigger `retry`) |
| `GET /maintenance/runs/{id}/stream` | E, I | Live log, Server Sent Events (below) |
| `GET /runbooks?q&tag`, `GET /runbooks/{idOrSlug}` | E, I | Runbooks (those tagged `contract:<id>` of other contracts are hidden) |
| `POST /runbooks`, `PATCH /runbooks/{idOrSlug}` | E, I | Write runbooks (contract tags only for own contracts) |
| `DELETE /runbooks/{idOrSlug}` | I | External engineers never delete |
| `GET /postmortems?status`, `GET /postmortems/{id}` | E, I | Postmortems on assigned contracts |
| `POST /postmortems` `{ticketId, timeline?, impact?, rootCause?, fix?, prevention?, submit?}` | E, I | Write (or create) the postmortem of a P1 |
| `PATCH /postmortems/{id}` `{...sections, submit?}` | E, I | Edit a DRAFT; `submit: true` needs every section and closes the ticket |
| `GET /payouts` | E | Own ISSUED and PAID payouts |
| `GET /payouts/{id}/statement` | E | The PDF statement |

### Response shapes the ops app needs

`GET /ops/v1/me`:

```json
{
  "user": { "id": "u1", "name": "Rami Haddad", "locale": "en" },
  "engineer": { "kind": "EXTERNAL", "country": "JO", "timezone": "Asia/Amman", "status": "ACTIVE", "currency": "USD" },
  "lead": false,
  "contracts": [{ "id": "c1", "customer": "Acme", "status": "ACTIVE", "plan": { "code": "BUSINESS", "name": "Business", "coverage": "TWENTY_FOUR_SEVEN" }, "calendar": "SA", "timeZone": "Asia/Riyadh", "accessPolicy": "ANY", "activatedAt": "..." }],
  "currentShift": { "id": "s1", "role": "PRIMARY", "startsAt": "...", "endsAt": "...", "startedAt": "...", "endedAt": null },
  "openPages": [{ "id": "p1", "alertId": "a1", "ticketId": "t1", "urgency": "high", "channel": "SMS", "message": "...", "sentAt": "...", "ackAt": null, "escalatedAt": null, "createdAt": "..." }],
  "runningTimer": { "id": "tm1", "contractId": "c1", "ticketId": "t1", "ticket": { "id": "t1", "number": 1042 }, "maintenanceRunId": null, "note": null, "startedAt": "...", "lastActivityAt": "...", "promptedAt": null, "stoppedAt": null, "stopReason": null, "workLogId": null, "elapsedSeconds": 754 },
  "activeGrants": ["<grant, below>"],
  "lastHandover": { "id": "h1", "shiftId": "s0", "author": { "id": "u2", "name": "..." }, "openTickets": [{ "id": "t9", "number": 1001, "subject": "...", "priority": "P2", "status": "open", "contractId": "c1" }], "risks": "...", "pendingMaintenance": "...", "notes": "...", "createdAt": "...", "read": true }
}
```

Ticket (lists and `ticket` in the workspace): `id, number, subject, status, priority (P1..P4),
contractId, assetId, asset {id, name}, assigneeId, assignee {id, name}, source, responseDueAt,
resolveDueAt, firstRespondedAt, closedAt, warnedAt, breachedAt, responseBreached, resolveBreached,
slaSecondsLeft (next target, negative when late, null when resolved), createdAt, updatedAt`.

Ticket workspace (`GET /ops/v1/tickets/{id}`): `ticket`, `messages` (`id, fromSupport, internal,
rootCause, authorId (staff only), author, body, createdAt`), `sla`, `asset` (the asset card:
`asset`, `links {metrics, logs}` or null, `recentAlerts`, `lastPatch`, `lastBackupTest`),
`alerts`, `workLogs` (`id, user {id, name}, minutes, billable, note, workedAt`), `escalation
{suggested, afterMinutes}` (suggested on an open P1 older than `escalationSuggestMinutes`),
`timer` (your running timer on this ticket), `grants`, `suggestedRunbooks` (`id, slug, title,
tags, score, reasons`) and `postmortem {id, status, dueAt}` or null.

Grant: `id, contractId, assetId, asset {id, name}, ticketId, ticket {id, number},
maintenanceRunId, reason, requestedMinutes, grantedMinutes, status, auto, emergency, approvedById,
approvedAt, denyReason, startsAt, expiresAt, secondsLeft, extensions, extendedAt, extensionReason,
revokedAt, revokeReason, principals, certSerial, createdAt` (the back office adds `engineer`).

Timesheet entry: `id, contractId, customer, ticketId, ticket {id, number}, maintenanceRunId,
minutes, sessionMinutes, billable, note, status, source (TIMER | MANUAL), flagged, reason,
workedAt, startedAt, endedAt, submittedAt, reviewedAt, reviewComment, createdAt`; the timesheet
adds `period, from, to, totals {minutes, byStatus}, runningTimer`.

Payout: `id, period, currency, hourlyRateMinor, standbyFeeMinor, nightMultiplier, standbyShifts,
standbyMinor, workedMinutes, nightMinutes, workMinor, totalMinor, lines {workLogs[], shifts[]},
status, issuedAt, paidAt, paidReference, hasStatement, generatedAt`.

## Back office (`/admin/ops`)

Staff routes use the existing staff areas and need staff two factor sign in. L is the
`support_lead` area, F is full staff only.

| Method and path | Who | What |
|---|---|---|
| `GET, POST /engineers`, `GET, PATCH, DELETE /engineers/{id}` | L (rates F) | Profiles; `status` SUSPENDED or OFFBOARDED runs offboarding; DELETE offboards. `{id}` is the profile id or the user id |
| `GET, POST /engineers/{id}/assignments`, `DELETE /engineers/{id}/assignments/{contractId}` | L | Contract assignments (residency checked); unassigning revokes that contract's grants |
| `PATCH /contracts/{id}/access-policy` `{accessPolicy}` | F | Residency policy; answers `removedAssignments` |
| `GET /settings`, `PATCH /settings` | L reads, F writes | Ops settings (below) |
| `GET /access/grants?status&userId&contractId&assetId`, `GET /access/grants/{id}` | L | Grants |
| `POST /access/grants/{id}/approve` `{minutes?}` | L | Never your own; residency re-checked |
| `POST /access/grants/{id}/deny` `{reason}`, `POST /access/grants/{id}/revoke` `{reason}` | L | Deny; revoke (certificates and live sessions too) |
| `GET /access/ca` | L, engineer staff | The CA public key for sshd `TrustedUserCAKeys` |
| `GET /sessions?status=live\|...&userId&assetId&grantId`, `GET /sessions/{id}` | L | Terminal sessions |
| `GET /sessions/{id}/playback` | L | Five minute URL to the asciicast v2 recording |
| `GET /sessions/{id}/recording` | L | The asciicast file streamed through the API |
| `POST /sessions/{id}/kill` `{reason}` | L | Kill a live session |
| `GET, PUT, DELETE /assets/{id}/secrets` | L | Secret keys for the gateway to inject (values write only) |
| `GET /timesheets?status=SUBMITTED&month` | L | Engineers with entries waiting |
| `GET /timesheets/{engineerId}?month\|week&status` | L | One engineer's entries |
| `POST /timesheets/{engineerId}/approve` `{decision: APPROVED \| REJECTED, workLogIds? \| month?, comment?}` | L | Review SUBMITTED entries (rejection needs a comment; never your own) |
| `GET /postmortems?status&overdue=true`, `GET /postmortems/{id}` | L | Postmortems |
| `POST /postmortems/{id}/close` `{comment?}` | L | Close a SUBMITTED postmortem |
| `GET /payouts?period&status&engineerId`, `GET /payouts/{id}`, `GET /payouts/{id}/statement` | F | Payouts |
| `POST /payouts/{month}/generate` `{engineerId?}` | F | Generate or regenerate DRAFT payouts |
| `PATCH /payouts/{id}` `{status: ISSUED}` or `{status: PAID, paidReference, paidAt?}` | F | Issue, or mark paid with the transfer reference |

Shifts themselves are scheduled in the managed back office (`/admin/managed/oncall/shifts`); active
engineer profiles can hold shifts like staff.

## Access flow

1. The engineer requests a grant for one asset and one open ticket (or maintenance run) with a
   reason and a duration. Sites cannot be granted (no shell), and the asset needs a management
   address.
2. The approval rule (`modules/ops/access/approval-rules.ts`): a P1 or P2 ticket, the engineer on
   call now (a PRIMARY or SECONDARY shift covering this moment that they have not ended) and the
   asset on a contract they may work on: approved automatically for `autoGrantMinutes` (120) as an
   emergency grant. Anything else waits for a support lead (mail and low urgency page), who
   approves up to `maxGrantMinutes` (240) or denies. A request nobody decides expires after
   `grantRequestExpiryMinutes`.
3. The `opsAccessGrant` workflow activates the approved grant: status ACTIVE, `startsAt` now,
   `expiresAt` after the granted minutes, principals `["prgd-asset-<assetId>"]`. It then sleeps
   until `expiresAt`, waking on extensions and revocations, and expires the grant.
4. The engineer opens a terminal (`POST /ops/v1/sessions`); the gateway checks the one time token
   and gets a certificate for its own ephemeral key, valid until the grant expires.
5. One extension per grant, with a reason, of at most `maxGrantMinutes`, counted from the
   current expiry.
6. The grant ends and its certificates are revoked (step-ca `ssh/revoke`, and `revokedAt` on
   every `prgd_ssh_certificates` row) when it expires, when its ticket is closed (by anyone), at
   the end of the engineer's shift for non emergency grants, when the engineer is suspended,
   offboarded or unassigned from the contract, when the contract's residency policy excludes
   them, and when a support lead revokes it. Live sessions on it are killed.

## Gateway contract

`prgd-gateway` is a separate container. It accepts WebSocket connections from the ops console,
connects to the asset over SSH with a short lived certificate, records the session as asciicast
v2, injects secrets, enforces the grant expiry and kills sessions on revocation. Its private keys
never leave it: it generates an ed25519 key pair per session and sends the API only the public
half.

**Token format.** `POST /ops/v1/sessions` `{grantId}` answers:

```json
{
  "sessionId": "cmsess1",
  "token": "prgd_gws_3q2wD...43 characters of base64url",
  "tokenExpiresAt": "2026-09-28T10:01:00.000Z",
  "gatewayUrl": "wss://gateway.progrid.co/v1/terminal?session=cmsess1",
  "asset": { "id": "cmasset1", "name": "web-1" },
  "ticket": { "id": "cmticket1", "number": 1042 },
  "grant": { "id": "cmgrant1", "expiresAt": "2026-09-28T12:00:00.000Z" },
  "recorded": true,
  "policy": { "clipboardPaste": true, "fileDownload": false }
}
```

The token is `prgd_gws_` plus 32 random bytes in base64url, valid once for
`PRGD_GATEWAY_TOKEN_TTL_SECONDS` (60); only its sha256 is stored. The browser opens `gatewayUrl`
and sends the token as its first text frame, `{"type": "auth", "token": "prgd_gws_..."}`, so it
never appears in a URL or an access log. The gateway then calls session-check.

**Authentication.** Every `/internal/gateway/*` call carries the header
`X-Prgd-Gateway-Secret: <PRGD_GATEWAY_SECRET>`, compared in constant time. A missing or wrong
secret answers 401; an empty `PRGD_GATEWAY_SECRET` refuses every call. Put the gateway on the
private network and do not publish `/internal` on the public proxy.

**`POST /internal/gateway/session-check`**

```json
{
  "token": "prgd_gws_3q2wD...",
  "sessionId": "cmsess1",
  "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... gateway",
  "gatewayId": "gw-1",
  "clientIp": "203.0.113.9"
}
```

`sessionId`, `gatewayId` and `clientIp` are optional (a `sessionId` that does not match the
token is refused). Only `ssh-ed25519` keys are accepted. 200 answers:

```json
{
  "sessionId": "cmsess1",
  "grantId": "cmgrant1",
  "expiresAt": "2026-09-28T12:00:00.000Z",
  "engineer": { "id": "cmuser1", "name": "Rami Haddad" },
  "asset": { "id": "cmasset1", "name": "web-1", "contractId": "cmcontract1" },
  "ticket": { "id": "cmticket1", "number": 1042 },
  "maintenanceRunId": null,
  "target": { "host": "10.8.0.70", "port": 22, "username": "prgd" },
  "certificate": "ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQt... prgd-session-cmsess1",
  "certSerial": "4611686018427387904",
  "principals": ["prgd-asset-cmasset1"],
  "validBefore": "2026-09-28T12:00:00.000Z",
  "secrets": [{ "ref": "assets/cmasset1", "keys": ["sudo_password"] }],
  "recording": {
    "format": "asciicast-v2",
    "key": "sessions/2026/09/cmsess1.cast",
    "uploadUrl": "https://s3.sa1.progrid.sa/prgd-session-recordings/sessions/2026/09/cmsess1.cast?X-Amz-...",
    "uploadMethod": "PUT",
    "contentType": "application/x-asciicast",
    "uploadUrlExpiresAt": "2026-09-28T13:00:00.000Z"
  },
  "policy": { "clipboardPaste": true, "fileDownload": false },
  "banner": "This session is recorded. web-1, ticket #1042, access until 2026-09-28 12:00 UTC.",
  "kill": { "natsSubject": "prgd.gateway.sessions.kill", "heartbeatSeconds": 30 }
}
```

The certificate is an OpenSSH user certificate for the gateway's key: key id
`prgd-session-<sessionId>`, only the asset's principal, `permit-pty` only (no agent, port or X11
forwarding), valid from a minute ago until the grant expires, and pinned with `source-address`
to `PRGD_GATEWAY_SOURCE_ADDRESSES` when that is set. The session becomes ACTIVE and the token is
spent. Refusals are 401 `token_invalid` (unknown token) or 409 with the code:
`token_used`, `token_expired`, `grant_inactive`, `grant_expired`, `session_killed`,
`residency_blocked`, `engineer_inactive`, `forbidden` (no longer assigned) and
`asset_unavailable`.

**`POST /internal/gateway/session-events`**, one event per call:

```json
{ "sessionId": "cmsess1", "type": "heartbeat", "at": "2026-09-28T10:05:00Z", "gatewayId": "gw-1", "bytesIn": 1200, "bytesOut": 48000 }
```

`type` is `started`, `heartbeat` (every `heartbeatSeconds`), `ended` (with `reason`:
`client_closed`, `grant_expired`, `killed`, `ssh_closed` or `error`), `recording_stored` (with
`recordingKey` exactly as session-check returned it and `recordingSize` in bytes) or `error`
(with `error`). `bytesIn` and `bytesOut` are totals since the start. Every event counts as
engineer activity for the idle timer. The answer tells the gateway what to do:

```json
{ "ok": true, "action": "continue", "expiresAt": "2026-09-28T12:00:00.000Z" }
{ "ok": true, "action": "kill", "reason": "grant revoked: ticket_closed", "expiresAt": "2026-09-28T12:00:00.000Z" }
```

`expiresAt` moves when the grant is extended; the gateway ends the session itself at that time.

**Kill mechanism.** Two independent paths, so a session dies even when one fails:

1. The API publishes `{"sessionId", "grantId", "gatewayId", "reason", "at"}` on the NATS subject
   `prgd.gateway.sessions.kill` whenever a session is killed (staff kill, grant revoked or
   expired, engineer suspended or offboarded). The gateway subscribes and closes the session at
   once (ignoring session ids it does not hold).
2. The next event or heartbeat of a killed session, or of a session whose grant is no longer
   active or has expired, answers `action: "kill"`. With 30 second heartbeats a session dies within
   30 seconds even without NATS.

Pending sessions (token not used yet) of a revoked grant are marked KILLED, and their session-check
answers `grant_inactive`.

**Secrets.** `POST /internal/gateway/secrets` `{"sessionId", "ref": "assets/cmasset1"}` answers
`{"ref", "values": {"sudo_password": "..."}}` only for an ACTIVE session whose grant is active
and only for the session's own asset (`403` otherwise); every read is audited
(`ops.secret_resolved`, keys only). Inject values (for example answer sudo prompts) without
echoing them to the browser or into the recording.

**Recordings.** Record asciicast v2 (a header line, then `[time, "o", data]` output events, and
`"i"` input events if wanted). When the session ends, `PUT` the file to `recording.uploadUrl` with
`Content-Type: application/x-asciicast`, then send `recording_stored`. If the URL expired, get a new
one with `POST /internal/gateway/recording-url` `{"sessionId"}` (same shape as `recording`).
Recordings live in the platform bucket `PRGD_RECORDINGS_BUCKET` under
`sessions/<year>/<month>/<sessionId>.cast`; a daily job (03:30 UTC) deletes them after
`recordingRetentionMonths` (12) and sets `recordingExpiredAt`. Support leads play them with
`GET /admin/ops/sessions/{id}/playback` (asciinema-player) or `.../recording`.

## Certificates: step-ca and the local CA

`PRGD_SSH_CA=local` (development and tests) generates an ed25519 CA key on first use and keeps it
in `prgd_ssh_ca_keys`, sealed with the secretbox key; revocation is recorded on the certificate
rows only. Production uses step-ca:

```sh
step ca init --ssh                           # a CA with SSH user and host keys
step ca provisioner add prgd-gateway --type JWK --create --ssh
# ca.json now holds the provisioner's "encryptedKey" (a compact JWE)
```

Set `PRGD_SSH_CA=step-ca`, `PRGD_STEPCA_URL`, `PRGD_STEPCA_PROVISIONER=prgd-gateway`,
`PRGD_STEPCA_JWK` to the provisioner's `encryptedKey` (or a plain private JWK as JSON),
`PRGD_STEPCA_PASSWORD` to its password, `PRGD_STEPCA_ROOT_FINGERPRINT`, and point
`NODE_EXTRA_CA_CERTS` at the step root certificate so TLS verifies. The API signs one time tokens
(`aud` is the endpoint, `sub` the key id or serial, a `step.ssh` claim with the certificate type,
key id, principals and validity) and calls `POST /1.0/ssh/sign` and `POST /1.0/ssh/revoke`.
Limit the provisioner's SSH user certificate duration in `ca.json` to eight hours (the longest grant plus its extension).

On every managed asset:

```sh
# /etc/ssh/sshd_config
TrustedUserCAKeys /etc/ssh/prgd_user_ca.pub          # GET /admin/ops/access/ca, or step ssh config --roots
AuthorizedPrincipalsFile /etc/ssh/auth_principals/%u
# /etc/ssh/auth_principals/prgd contains one line: prgd-asset-<assetId>
```

The login user is `PRGD_SSH_LOGIN_USER` (`prgd`, the same user the maintenance runner uses) and
the address is the asset's management address, reached over the WireGuard management network.

## Secrets: Vault or Infisical

The gateway injects credentials from `SecretStore` (`modules/ops/secrets/secret-store.ts`). Refs
are `assets/<assetId>`; support leads set the values with `PUT /admin/ops/assets/{id}/secrets`
`{"values": {"sudo_password": "..."}}` (the answer and `GET` list keys only).

- **Vault** (`PRGD_SECRET_STORE=vault`): KV version 2 at `PRGD_VAULT_MOUNT` (`prgd`), token
  `PRGD_VAULT_TOKEN`, address `PRGD_VAULT_ADDR`. Enable it with
  `vault secrets enable -path=prgd kv-v2` and give the token a policy with create, read, update
  and delete on `prgd/data/assets/*` and delete on `prgd/metadata/assets/*`.
- **Infisical** (`PRGD_SECRET_STORE=infisical`): a machine identity token
  (`PRGD_INFISICAL_TOKEN`) with access to project `PRGD_INFISICAL_PROJECT`, environment
  `PRGD_INFISICAL_ENV` (`prod`); each asset is the folder `/assets/<assetId>`.
- **Local** (`PRGD_SECRET_STORE=local`, development only): sealed JSON rows in `prgd_ops_secrets`.

## Timers and timesheets

Only the timer creates time. One running timer per engineer (also a partial unique index), on a
ticket or a maintenance run. Stopping creates a DRAFT worklog with the window (`startedAt`,
`endedAt`) and `sessionMinutes`, the minutes of the engineer's terminal sessions inside the
window. The `opsTimerIdle` workflow prompts the engineer (mail and low urgency page) after
`timerIdlePromptSeconds` (3600) without activity and stops the timer after
`timerAutoStopSeconds` (5400), counting time up to the last activity and flagging the entry.
Activity is any ticket action, any terminal session event and `POST /ops/v1/activity`.

Manual entries need a reason and are flagged for review. Worklogs go DRAFT, SUBMITTED, then
APPROVED or REJECTED (a support lead, with a comment for rejections; a rejected entry can be fixed
and goes back to DRAFT), then PAID with a contractor payout. Only APPROVED and PAID worklogs count
for customer overage (`ManagedBillingService`), the usage view (which also shows
`pendingApprovalMinutes`), monthly reports and payouts, all reading the same rows, so the
customer's bill and the contractor's pay can never disagree. Time staff log in the back office
(`POST /admin/managed/worklogs`) is APPROVED at once, as before.

## Shifts and handovers

`POST /ops/v1/shifts/start` takes the shift that is running or starts within 30 minutes and needs
the checklist `{"pagingAppOnline": true, "vpnWorking": true, "twoFactorWorking": true,
"lastHandoverRead": true}` (`422 checklist_incomplete` lists what is missing) and the last
handover really read through `GET /ops/v1/shifts/handover/latest` (`409 handover_not_read`).

`POST /ops/v1/shifts/end` needs `{"handover": {"risks", "pendingMaintenance", "notes",
"ticketIds?"}}`; the engineer's open tickets are added automatically. It revokes the engineer's
non emergency grants, and the ended shift no longer receives pages. The `opsShift` workflow also
revokes non emergency grants at the scheduled end, reminds the engineer `handoverReminderMinutes`
(15) after it when there is no handover, and notifies the support lead after
`handoverEscalateMinutes` (60). A completed shift (started and ended) earns the standby fee.

## Postmortems and runbooks

Every managed P1 needs a postmortem. Closing one, from the ops console, the back office or by the
customer, moves it to `resolved_pending_pm`, which customers see as closed (their lists filter it
under closed). A DRAFT postmortem is created at once, due `postmortemDueHours` (48) after the
resolution and prefilled with a timeline (alerts, opening, first response, internal notes,
resolution) and the root cause note. Submitting needs every section (timeline, impact, root
cause, fix, prevention; `422 postmortem_incomplete` lists the empty ones) and closes the ticket. A
support lead closes the postmortem. `opsPostmortemDue` reminds the author a day before it is due
and tells the support lead when it is overdue.

The ticket workspace suggests up to five runbooks: 5 points for a tag naming the asset or its
contract (`asset:<id>`, `contract:<id>`) or describing it (os, provider, kind), 3 for each tag or
title word matching a word of the ticket's alert names (CamelCase is split, so `HostDown` matches
`host`, `down` and `hostdown`), and 1 for each title word in the ticket text.

## Contractor payouts

On the 3rd at 05:00 UTC a job starts `opsPayoutRun` for the previous month. For every external
engineer with a rate it takes the APPROVED worklogs no payout included yet (up to the end of the
month) and the completed shifts, and computes, in the engineer's currency:

    standby = standbyFeeMinor x completed shifts
    each worklog line = round((day minutes x rate + night minutes x rate x nightMultiplier) / 60)
    total = standby + sum of the lines

Night is `nightStartHour` to `nightEndHour` (22:00 to 06:00) in the contract's local time
(`Asia/Riyadh` for the SA calendar, `Europe/Istanbul` for TR), not the engineer's. The payout gets
a PDF statement in the invoice style and is ISSUED to the engineer by mail. Full staff pay by bank
transfer outside the platform and mark it PAID with the reference
(`PATCH /admin/ops/payouts/{id}`), which marks its worklogs PAID. Drafts can be regenerated; issued
and paid payouts never change. Rates (`hourlyRateMinor`, `standbyFeeMinor`, `currency`,
`nightMultiplier`) are set per engineer by full staff; there is no default rate.

## Offboarding

Setting an engineer SUSPENDED or OFFBOARDED (`PATCH /admin/ops/engineers/{id}`) ends their ops
sessions, revokes every live grant and its certificates, kills live terminal sessions, stops the
running timer and ends the current shift. OFFBOARDED also deletes future shifts and every
assignment, and cannot be undone. Every asset they accessed in the last 90 days (a grant that
became active or a terminal session) gets a P3 "Rotate credentials" ticket; the customer sees a
neutral message, the internal note names the engineer and what to rotate (the secret store entry,
the `prgd` user's keys, anything shown in their sessions). The summary is in the
`ops.engineer_access_removed` audit event.

## Maintenance from the ops console

Engineers see the tasks of their contracts, run one now or retry a failed run; runs execute on
the platform exactly as scheduled ones (Temporal and the configured runner), never from the
engineer's machine, and a failed run's P3 ticket is assigned to the engineer who started it. The
runner hands its output over as it goes and the run's log is written about once a second.
`GET /ops/v1/maintenance/runs/{id}/stream` is a Server Sent Events stream:

    event: status
    data: {"status":"RUNNING"}

    event: log
    data: {"offset":0,"chunk":"PLAY [patching.yml] ****\n..."}

    event: end
    data: {"status":"FAILED","error":"simulated failure","finishedAt":"..."}

Use `fetch` with the Bearer header and read the body as a stream, or an `EventSource` with the
`prgd_ops_session` cookie (credentials included).

## Settings

`GET /admin/ops/settings` answers `{settings, defaults, stored, updatedAt, updatedById}`;
`PATCH /admin/ops/settings` (full staff) takes any subset.

| Key | Default | Meaning |
|---|---|---|
| `alertAckTargetSeconds` | `PAGE_ACK_TIMEOUT_SECONDS` (600) | Unacknowledged high urgency pages go to the support lead |
| `escalationSuggestMinutes` | 45 | The workspace suggests Escalate on an open P1 this old |
| `autoGrantMinutes` | 120 | Duration of auto approved grants |
| `maxGrantMinutes` | 240 | Longest grant and longest extension |
| `maxExtensions` | 1 | Extensions per grant |
| `grantRequestExpiryMinutes` | 240 | Undecided requests expire |
| `timerIdlePromptSeconds` | `PRGD_OPS_TIMER_IDLE_PROMPT_SECONDS` (3600) | Idle prompt |
| `timerAutoStopSeconds` | `PRGD_OPS_TIMER_AUTO_STOP_SECONDS` (5400) | Idle stop |
| `recordingRetentionMonths` | 12 | Recording retention |
| `postmortemDueHours` | 48 | Postmortem due after resolution |
| `nightStartHour`, `nightEndHour` | 22, 6 | Night window, contract local time |
| `defaultNightMultiplier` | 1.5 | For new engineer profiles |
| `defaultAccessPolicy` | ANY | For new contracts |
| `handoverReminderMinutes`, `handoverEscalateMinutes` | 15, 60 | Missing handover reminder and escalation |

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `PRGD_OPS_URL` | `http://localhost:3002` | The ops console; mail links and the WebAuthn origin |
| `PRGD_OPS_RP_ID`, `PRGD_OPS_RP_NAME` | `localhost`, `Progrid Ops` | WebAuthn relying party |
| `PRGD_OPS_SESSION_TTL_SECONDS` | 43200 | Ops session lifetime |
| `PRGD_GRAFANA_URL` | empty | Asset metric and log links |
| `PRGD_OPS_TIMER_IDLE_PROMPT_SECONDS`, `PRGD_OPS_TIMER_AUTO_STOP_SECONDS` | 3600, 5400 | Defaults of the idle settings |
| `PRGD_SSH_CA` | `local` | `local` or `step-ca` |
| `PRGD_STEPCA_URL`, `PRGD_STEPCA_PROVISIONER`, `PRGD_STEPCA_JWK`, `PRGD_STEPCA_PASSWORD`, `PRGD_STEPCA_ROOT_FINGERPRINT` | empty | step-ca |
| `PRGD_SSH_LOGIN_USER`, `PRGD_SSH_PORT` | `prgd`, 22 | Where the gateway logs in |
| `PRGD_GATEWAY_SECRET` | empty (refuses every call) | Shared secret of `/internal/gateway` (vault `vault_prgd_gateway_secret`) |
| `PRGD_GATEWAY_PUBLIC_URL` | `ws://localhost:4100` | Gateway WebSocket endpoint given to the ops console |
| `PRGD_GATEWAY_TOKEN_TTL_SECONDS` | 60 | One time gateway token lifetime |
| `PRGD_GATEWAY_SOURCE_ADDRESSES` | empty | Pins certificates to the gateway's addresses |
| `PRGD_RECORDINGS_BUCKET` | `prgd-session-recordings` | Platform bucket for recordings |
| `PRGD_SECRET_STORE` | `local` | `local`, `vault` or `infisical` |
| `PRGD_VAULT_ADDR`, `PRGD_VAULT_TOKEN`, `PRGD_VAULT_MOUNT` | empty, empty, `prgd` | Vault KV v2 |
| `PRGD_INFISICAL_URL`, `PRGD_INFISICAL_TOKEN`, `PRGD_INFISICAL_PROJECT`, `PRGD_INFISICAL_ENV` | `https://app.infisical.com`, empty, empty, `prod` | Infisical |

Secrets go in the Ansible vault: `vault_prgd_gateway_secret`, `vault_prgd_stepca_jwk`,
`vault_prgd_stepca_password`, `vault_prgd_vault_token`, `vault_prgd_infisical_token`.

## Workflows and jobs

| Workflow | Id | Started by |
|---|---|---|
| `opsTimerIdle` | `ops-timer-idle-<timerId>` | Timer start |
| `opsAccessGrant` | `ops-grant-<grantId>` | Grant request |
| `opsShift` | `ops-shift-<shiftId>` | Shift start |
| `opsPostmortemDue` | `ops-postmortem-<id>` | A P1 resolved without a postmortem |
| `opsPayoutRun` | `ops-payout-<period>` | Job at 05:00 UTC on the 3rd |

The daily job at 03:30 UTC deletes expired recordings and expires unused gateway tokens. When
Temporal is unreachable, grant activation runs inline so an approved grant still works.

## Tables

`prgd_engineer_profiles`, `prgd_engineer_assignments`, `prgd_webauthn_credentials`,
`prgd_ops_settings`, `prgd_work_timers`, `prgd_access_grants`, `prgd_ssh_ca_keys`,
`prgd_ssh_certificates`, `prgd_terminal_sessions`, `prgd_ops_secrets`, `prgd_handovers`,
`prgd_postmortems`, `prgd_contractor_payouts`, plus new columns on `prgd_sessions` (audience,
second factor, nullable team), `prgd_managed_contracts` (access policy), `prgd_ticket_messages`
(root cause), `prgd_work_logs` (review states and window), `prgd_on_call_shifts` (start, end,
checklist) and the `resolved_pending_pm` ticket status.

## Tests

Unit tests cover the approval and extension rules, residency and eligibility, the IP allowlist,
the masking mappers, timesheet periods, OpenSSH certificates, the step-ca, Vault and Infisical
adapters, runbook scoring, night minutes and payout math. The integration suite
(`apps/api/test/integration/ops.it.ts`) runs sign in with TOTP and a software WebAuthn key, the
audience split, the IP allowlist, assignment scoping, residency, masking, idle timers, timesheet
review, overage from approved time only, auto and lead approved grants with local CA
certificates, extension, revocation on ticket close, the full gateway contract (tokens, expired
and revoked grants, secrets, events, kills, recordings), shifts and handovers, postmortems and
runbooks, payouts with the night multiplier, offboarding, maintenance with the live log, alert
acknowledgement, escalation and settings.

## Running the gateway

The gateway is `services/prgd-gateway` (package `@prgd/gateway`, image `prgd-gateway`). Its
WebSocket protocol, configuration and limits are in `services/prgd-gateway/README.md`. In short:
the ops app opens `wss://gateway.progrid.co/v1/terminal?session=<id>` (`gateway.progrid.sa` from ops.progrid.sa), sends
`{"type":"auth","token"}` first, then `input`, `resize` and `ping` frames; the gateway answers
`ready`, `output` (base64), `notice`, `pong` and a final `closed` with the reason.

**Contract addition.** The `started` event also carries `hostKey` (the asset's SSH host key as an
OpenSSH line) and `hostKeyFingerprint`; the API writes both into the `ops.session_started` audit
entry.

**Production.** The `gateway` service in `infra/prod/docker-compose.yml` is on the internal
network and gets only its own settings (`PRGD_GATEWAY_SECRET`, `PRGD_GATEWAY_ID`,
`PRGD_GATEWAY_ALLOWED_ORIGINS`, `PRGD_GATEWAY_KNOWN_HOSTS`, `PRGD_GATEWAY_MAX_SESSIONS`, the NATS
token), never the whole `prgd.env`. It calls the API at `http://api:4000/internal/gateway`, which
Caddy does not publish; Caddy publishes only `/v1/terminal` at `gateway.{$DOMAIN}`. Recordings
wait in the `gateway-spool` volume until uploaded. The gateway must also reach the recordings bucket
through its presigned URLs (`S3_ENDPOINT`, for example `https://s3.sa1.progrid.sa`).

**Reaching the assets.** The gateway opens SSH to each asset's management address (`10.8.0.x`),
which lives on the WireGuard management network. The management host must therefore be a
WireGuard peer of every managed customer network, and route that range out of `wg0`; containers
on the compose bridge reach it through the host's routing and NAT, so the SSH connections leave
from the host's WireGuard address. Set `PRGD_GATEWAY_SOURCE_ADDRESSES` to that address (`10.9.0.1/32`
with the Ansible role `wireguard`) so certificates only work from there, and make sure each asset's
firewall allows port 22 from it. The role sets up `wg0` between the management host and the Proxmox
nodes (`10.9.0.0/24`, docs/hosting.md); managed customer networks are not peers yet, so add their peers
and route their range out of `wg0` before the first terminal session on them.

**Host keys.** Without `PRGD_GATEWAY_KNOWN_HOSTS` the gateway trusts the first host key an asset
presents and pins it in memory until it restarts (the key is in the audit log either way). That is
a development setting: in production collect each asset's host key when it is provisioned, put
them in the Ansible variable `prgd_gateway_known_hosts` (known_hosts format, `[10.8.0.70]:22` or
`10.8.0.70`), which writes `/opt/prgd/gateway/known_hosts` and sets
`PRGD_GATEWAY_KNOWN_HOSTS=/etc/prgd-gateway/known_hosts`, and reload it with
`docker compose kill -s HUP gateway`. SSH host certificates from step-ca would remove the list,
but the gateway's SSH library cannot verify host certificates yet.

**Sudo passwords.** The gateway answers sudo's own prompt for the login user with the asset's
stored `sudo_password` and redacts the value from the terminal and the recording. A program the
engineer runs can imitate the prompt and capture what the gateway types, so the stored password
must be treated as reachable by anyone holding a grant on the asset: use a password only for
this, rotate it (offboarding opens rotate secrets tasks), and prefer `NOPASSWD` rules for specific
commands where the customer allows it.

**Scaling.** Each gateway holds its sessions in memory. Several gateways can run behind Caddy
(each with its own `PRGD_GATEWAY_ID`); kills reach all of them over NATS and each ignores sessions
it does not hold. `PRGD_GATEWAY_MAX_SESSIONS` (50) caps one instance.
