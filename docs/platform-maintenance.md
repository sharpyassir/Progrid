# Platform maintenance

The recurring upkeep of Progrid's own platform (the management server, the compute hosts, the
control plane), kept in the DevOps console under **Platform** (`ops.progrid.sa/platform`). The
system does as much as it can by itself; the engineer handles what is left and leaves a record.

## How it runs

- **Periods.** Every task has one run per period: ISO week (Monday to Sunday, UTC), calendar
  month or quarter. A job at five past every hour opens the runs of the new period
  (`prgd_platform_task_runs`, one row per task and period).
- **Checks.** At 06:00 UTC every day, after the nightly backups, the system runs the automatic
  check of every open task in the current period and stores the result (pass, warn or fail, one
  line per finding). Engineers can also press **Run check now**.
- **Automatic tasks** close themselves when the check passes. A warning or failure leaves the
  task as **Needs attention**; the engineer fixes the cause and closes it with a note on how each
  warning was handled.
- **Assisted tasks** run a check that gathers the facts, but the engineer does the work and
  closes the task.
- **By hand** tasks have no check; the engineer closes them with a note and evidence.
- **Overdue.** A task not closed by the end of its period becomes overdue. The staff inbox
  (`SUPPORT_INBOX`) gets one mail listing the newly overdue tasks, and they stay at the top of
  the page until someone closes them, with what was done or why it was skipped.
- **Record.** Every close keeps the note, the evidence, the minutes spent, who closed it and
  when, and is written to the audit log (`ops.platform_task_done`). Platform minutes are not
  added to timesheets (those belong to customer contracts); the page shows the month's total.

## Tasks

| Task | Cadence | Mode | What the system does | What the engineer does |
|---|---|---|---|---|
| Apply security patches | weekly | assisted | Lists the hosts to patch, warns when the API has not been redeployed for 14 days | `apt upgrade` on staging, then production, reboot for a new kernel; paste the summary (evidence required) |
| Review monitoring and alerts | weekly | auto | Hosts reporting in the last 10 minutes and their allocation, customer and managed alerts open over a day, database reachable | Only on warnings |
| Verify backups | weekly | auto | Every customer server with backups on has one from the last 26 hours, failed backups this week, the platform database backup (below) | Only on warnings |
| Check abuse reports | weekly | auto | Open abuse flags, new ones this week | Resolve flags in the back office |
| Test a restore | monthly | by hand | | Restore last night's dump into a scratch database and one customer backup into a test server; record the timing (evidence required) |
| Review access | monthly | auto | Failed sign ins in 30 days (console and ops) with the top addresses, staff and contract engineers without two factor sign in, API tokens unused for 90 days, access grants | Only on warnings |
| Review capacity | monthly | auto | vCPU (with overcommit), memory and disk allocation: warn at 70%, fail at 85%; free public IPv4 addresses | Order hardware or an IP block before 85% |
| Review code and dependencies | monthly | by hand | | Merge dependency updates, read the advisories, review the month's changes to auth, billing and access |
| Security audit | quarterly | assisted | TLS expiry of every public host name (fail under 14 days, warn under 30), probes the management server's public address for open ports outside `PRGD_PLATFORM_EXPECTED_PORTS`, staff without two factor | Rotate server, database and vault secrets, review staff permissions (evidence required) |
| Disaster recovery drill | quarterly | by hand | | Rebuild the control plane on a fresh server from the off server backup by the runbook; record the time to recover (evidence required) |
| Update runbooks | quarterly | assisted | Counts the runbooks updated this quarter | Fold the quarter's incidents and the drill into the runbooks |

The list is code (`apps/api/src/modules/ops/platform/catalog.ts`), the checks are in
`checks.ts`, the titles and steps are i18n strings in `apps/ops` (`plt_<task>_t` and `_s`).

## Platform database backup

`infra/prod/backup.sh` (the `backup` container) reports every nightly result to
`POST /internal/platform/backup` with the header `X-Prgd-Platform-Secret`:

```json
{ "result": "ok", "offsite": true, "sizeBytes": 123456, "file": "all-20261002-0215.sql.gz" }
```

- `ok` with `offsite: true` (copied to `BACKUP_S3_URL`) passes; `ok` without the off server copy
  is a warning; no report in 26 hours, or a failed run after the last good one, fails. A failed
  run also mails the staff inbox at once.
- Set the same random value as `PRGD_PLATFORM_HEARTBEAT_SECRET` in `prgd.env` (the API) and in
  the compose `.env` (the backup container), for example `openssl rand -hex 32`. While it is
  empty the backup check fails with "no backup has reported yet".

## Settings

| Variable | Default | Use |
|---|---|---|
| `PRGD_PLATFORM_HEARTBEAT_SECRET` | empty | Shared secret of the backup report; empty refuses every report |
| `PRGD_PLATFORM_HOSTNAMES` | empty | More public host names to watch for TLS expiry, comma separated (the API, console and ops hosts and the website are always watched) |
| `PRGD_PLATFORM_EXPECTED_PORTS` | `22,80,443` | Ports allowed open on the management server's public address |

## Failed sign ins

Wrong passwords and wrong second factor codes in the customer console (`auth.login_failed`) and
wrong passwords in the ops console (`ops.signin_failed`) are written to the audit log with the
client address. The monthly access review reads them.
