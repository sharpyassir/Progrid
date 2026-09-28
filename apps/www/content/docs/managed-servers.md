---
title: Managed servers
description: Turn a server over to us for patching, hardening, watching and daily backups.
section: Guides
order: 15
---

## What managed means

A managed server is a normal server with a small care agent inside it and daily backups on. You still have root, your firewall rules and your own software. We take care of the operating system:

- **Updates.** Security and regular updates from the distribution install on their own every day. When a kernel or libc update needs a reboot, the server reboots at 04:00 in its own time zone, never at another time.
- **Hardening.** fail2ban watches SSH and bans an address for an hour after five failed logins. Password logins are turned off as soon as an SSH key is on the box, root can only log in with a key, and a few kernel safety settings are applied.
- **Watching.** Every five minutes the agent reports uptime, load, memory, disk, waiting updates, failed services and recent bans. The server page shows the last report and a health line: healthy, needs attention, not reporting, or waiting for the first report. A warning event fires when the disk passes 90 percent, memory is nearly full, a service has failed, or ten or more security updates are waiting, and a recovery event when it clears. Route these to email or a webhook from **Alerts**.
- **Backups.** Daily backups are on while a server is managed. They cannot be turned off separately; turn managed off first.

The agent is a single shell script and a standard library Python reporter. It keeps no credentials except its own report token and only talks to our API.

## Turning it on

Tick **Managed** when you create a server, pass `managed: true` to `POST /v1/servers`, use `prgd servers create web-1 --managed`, or set `managed = true` in Terraform. The agent installs during first boot alongside any cloud-init you supplied.

An existing server can be switched later from its page, with `prgd servers managed ID on`, or `PATCH /v1/servers/{id}` with `managed: true`. cloud-init has already run on a running server, so the page shows a one line install command to run once as root; `prgd servers managed ID status` shows the same command until the first report arrives. A rebuild installs it on its own.

Turning managed off stops the charge and the reports at once. The agent stays installed but its reports are refused; remove it with `apt-get remove unattended-upgrades fail2ban` and `systemctl disable --now prgd-managed.timer` if you no longer want it.

## Pricing

Managed servers are sold as plans that include the hardware, setup, OS updates, security hardening, daily backups and support: Managed Start (2 vCPU, 4 GB, 80 GB) at 199 SAR a month, Managed Business (4 vCPU, 8 GB, 160 GB) at 349 SAR, and Managed Pro (8 vCPU, 16 GB, 320 GB) at 599 SAR, all excluding 15 percent VAT, which is shown at checkout. The Starter plan cannot be managed. Turning managed off mid month only charges the hours it was on; backups then cost 20 percent of the plan if you keep them.

## Status and reports

`GET /v1/servers/{id}/managed` returns the tier, health, the issues behind a warning, the last report and the install command while the agent is not reporting. The report has these fields: `uptimeSec`, `load1`, `memTotalMb`, `memUsedMb`, `diskTotalGb`, `diskUsedGb`, `diskUsedPct`, `pendingUpdates`, `securityUpdates`, `rebootRequired`, `lastUpgradeAt`, `failedUnits`, `sshBanned`, `sshPasswordAuth`, `kernel`, `hostname` and `agentVersion`.

A report older than 15 minutes marks the server as not reporting. That usually means the server is off or the timer was disabled; a running server that stops reporting is worth a look.

## What it does not do

The agent does not touch your applications, databases or web servers, does not change your firewall, and does not log in to the server. Managed databases have their own care built in and do not use this agent.
