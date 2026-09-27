---
title: Monitoring and alerts
description: Graphs for every server and alert rules that email you when a threshold holds.
section: Guides
order: 15
---

## Metrics

Every server reports CPU, memory, disk throughput and network once a minute, straight from the hypervisor, with nothing to install inside the server. Disk used, which only the server itself can see, comes from the managed care agent on managed servers and from the database agent on managed database nodes. Open a server and choose **Metrics** to see the last hour, six hours, day, week or month. The week and month views show hourly averages with the peak CPU for each hour. Minute samples are kept for two weeks, hourly rollups for a year.

From the terminal or code:

```sh
pgcloud servers metrics srv_123 --period 6h
```

```ts
const m = await pg.servers.metrics('srv_123', '24h');
console.log(m.latest?.cpu, m.points.length);
```

Network and disk values in the API are bytes per second. Multiply by eight and divide by a million for megabits per second.

## Alert rules

A rule watches one metric on a set of servers: CPU, memory, disk used, inbound or outbound bandwidth, above or below a threshold, for a number of minutes. Pick the servers by name or by tag, or leave both empty to watch every server in the team. Two rules fire on events instead of a threshold and cover every resource of that kind in the team: `db_node_unreachable` when a managed database node has not answered for five minutes, and `app_deploy_failed` when an App Platform deploy fails. They resolve when the node answers again or the next deploy succeeds.

When the average over the window crosses the threshold, one incident opens. Team owners and admins get an email, any extra addresses on the rule get it too, and webhooks receive `alert.triggered` with the server, the value and the rule. When the value returns within limits, the incident resolves, one more email goes out, and webhooks receive `alert.resolved`. There is no repeat email while an incident stays open, so a long outage is one message, not fifty.

Create rules under **Core Cloud, Monitoring**, or from the terminal:

```sh
pgcloud alerts create "High CPU" --metric cpu --above 90 --minutes 10
pgcloud alerts create "Web tier bandwidth" --metric net_out --above 400 --tag web --email oncall@example.com
pgcloud alerts ls
pgcloud alerts mute alr_123
```

Muting a rule keeps it but stops evaluation. Incidents show on the Monitoring page while they fire and stay in the history afterwards.

## What to alert on first

- CPU above 90 percent for 10 minutes on every server. Catches runaway processes.
- Memory above 90 percent for 5 minutes. Catches leaks before the kernel starts killing things.
- Disk used above 85 percent for 5 minutes. Gives you time to grow the disk or clean up.
- Outbound bandwidth above your plan's expectation. Catches abuse and misconfigured backups.
