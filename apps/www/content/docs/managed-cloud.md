---
title: Managed cloud
description: Our engineers run your servers and sites under an SLA, on Progrid or on any other cloud.
section: Guides
order: 16
---

## What managed cloud is

With a managed cloud contract, Progrid engineers operate your servers and sites for you. We watch them day and night, patch them on a schedule, test that backups restore, answer tickets within agreed targets, and send you a report every month. The servers can run on Progrid or anywhere else: another cloud, a dedicated server or your own data center, as long as our engineers can reach them over a private management connection.

Managed cloud is a contract with a team, not a switch on a server. It covers a set of **assets**: Progrid servers, external servers and websites.

## Plans

| | Essential | Business | Enterprise |
|---|---|---|---|
| Price per month | 1,100 SAR | 3,000 SAR | Custom |
| Assets | up to 3 | up to 10 | agreed per contract |
| Coverage | Business hours | 24/7 | 24/7 |
| Engineer time included | 2 hours | 6 hours | agreed per contract |
| P1 response | 4 hours | 1 hour | 30 minutes |
| P2 response | 8 hours | 4 hours | 2 hours |
| P3 response | 2 business days | 1 day | 8 hours |
| P4 response | 5 business days | 3 days | 2 days |
| P1 resolution | 8 hours | 2 hours | 1 hour |
| P2 resolution | 16 hours | 8 hours | 4 hours |
| P3 resolution | 5 business days | 3 days | 1 day |
| P4 resolution | 10 business days | 7 days | 5 days |

Prices are in Saudi riyals and exclude 15 percent VAT, which your invoice adds. Engineer time beyond the included hours costs 250 SAR an hour, excluding VAT. Servers themselves are billed as usual; the managed fee covers the work, not the hardware.

**Business hours** means 09:00 to 17:00 local time on working days. Contracts use one of two calendars: Saudi Arabia (Sunday to Thursday, Riyadh time) or Türkiye (Monday to Friday, Istanbul time). Public holidays in that country do not count, so a P2 ticket opened on Thursday at 16:00 in Riyadh on the Essential plan is due for a first response on Sunday at 16:00. A business day is 8 working hours. On 24/7 plans every hour counts, and a day is 24 hours.

The response target is the time to the first answer from an engineer. The resolution target is the time to fix or to a workaround that restores service. Both start when the ticket is opened.

## What is included

1. **Monitoring and alerting.** Platform servers are monitored by the platform. External servers run a small monitoring agent that reports every minute; if it goes quiet for ten minutes we treat the server as down.
2. **Incident response.** A critical alert opens a P1 ticket and pages the engineer on call at once. Warnings open a P3 ticket that an engineer works in normal hours.
3. **Patching.** Operating system updates in an agreed monthly window, with a reboot when an update needs one.
4. **Backups and restore tests.** Backups on every server with data, and a regular test that a file really restores.
5. **Engineer time.** The included hours cover requests like configuration changes, investigations and advice.
6. **A monthly report** with uptime, incidents, service levels, maintenance and the hours used.

## Getting started

1. A team owner requests a plan from **Managed** in the console or with `POST /v1/managed/contracts`. The contract starts as **DRAFT**. Every team member can check the plan, status and service levels with `GET /v1/managed/summary`; prices and contract terms stay with the owners.
2. We contact you to agree the scope, the liability cap and the calendar, and sign the contract. The contract moves to **ONBOARDING**.
3. During onboarding our engineers install monitoring, configure backups and test a restore, get access through the management network, write the documentation and runbook for your setup, and agree the shared responsibility matrix with you.
4. When the checklist is complete the contract becomes **ACTIVE** and billing starts that day. The first month is charged for the days it was active.

Add assets at any time from the contract page or with `POST /v1/managed/contracts/{id}/assets`. A new asset stays **PENDING** until an engineer reviews it, usually within one business day.

```sh
curl -X POST https://api.progrid.sa/v1/managed/contracts \
  -H "Authorization: Bearer $PRGD_TOKEN" -H "content-type: application/json" \
  -d '{"plan":"ESSENTIAL","notes":"Two web servers on another cloud and our shop site"}'
```

## Tickets

Open a ticket from **Managed** in the console or with the API. Choose the priority by impact:

| Priority | Use it when |
|---|---|
| P1 | Production is down or data is at risk |
| P2 | Production works but is degraded, or a key feature is broken |
| P3 | A normal request or a problem with a workaround |
| P4 | A question, a small change or low impact |

```sh
curl -X POST https://api.progrid.sa/v1/managed/tickets \
  -H "Authorization: Bearer $PRGD_TOKEN" -H "content-type: application/json" \
  -d '{"subject":"Checkout is slow","body":"Pages take 20 seconds since 10:00","priority":"P2"}'
```

Every ticket shows its response and resolution due times. P1 and P2 tickets page the engineer on call right away. A ticket is **open** while it waits on us and **answered** while it waits on you; your replies go to the engineer working it. Tickets that our monitoring or a failed maintenance run opens appear in the same list, so you always see what we are working on.

Team owners and members can open and read tickets and see the assets. Only owners can request a plan, read the contract and read the reports.

## Monthly reports

On the 1st of each month we prepare the report for the month before. An engineer reviews it and adds recommendations, and it reaches the team owners by email as a PDF by the 3rd. Every report stays available under **Managed** in the console and through `GET /v1/managed/contracts/{id}/reports`.

The report covers:

1. **Uptime per asset.** The share of the month an asset was under management and not affected by a critical alert or a missing heartbeat. Overlapping alerts count once.
2. **Incidents.** Alerts by severity, and every P1 and P2 ticket with when it opened and when it was resolved.
3. **Service levels.** How many response and resolution targets were met and how many were missed.
4. **Maintenance.** Patch windows and backup restore tests, and whether they succeeded.
5. **Engineer time.** Hours used against the hours included.
6. **Recommendations** from your engineer.

## Shared responsibility

Every contract has a responsibility matrix that says who owns each area: **Progrid**, **you**, or **shared**. The starting point is below; we adjust it with you during onboarding and you can read the agreed version on the contract page.

| Area | Owner |
|---|---|
| Data center, hardware and hypervisor (Progrid servers) | Progrid |
| Operating system patching | Progrid |
| Monitoring and alerting | Progrid |
| Incident response | Progrid |
| Backups and restore tests | Progrid |
| Security hardening and firewall rules | Shared |
| Capacity planning | Shared |
| Compliance evidence (PDPL, NCA ECC) | Shared |
| Application code, releases and deployments | You |
| Application configuration and data | You |
| Application user accounts and credentials | You |
| Third party licenses | You |
| External cloud accounts and their bills | You |

For servers on another cloud, the provider remains responsible for its hardware and network.

## Suspension and cancellation

If an invoice stays unpaid and your account is suspended, the contract is suspended too. We keep monitoring your assets, but engineers do not work tickets or run maintenance, and no monthly fee accrues until it is resumed. It resumes on its own once the invoice is paid.

When a contract is cancelled, billing stops that day, we remove our access and stop monitoring and maintenance, and the team owners receive a handover document by email: the assets, the maintenance we ran, the responsibilities that are now yours and a short checklist for the first days on your own.

## Events

`ticket.opened`, `ticket.answered`, `ticket.replied` and `ticket.closed` go through webhooks like support tickets. Every contract change, alert and page is recorded in your team's audit log.
