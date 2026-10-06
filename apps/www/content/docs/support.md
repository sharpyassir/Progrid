---
title: Support plans
description: Four plans, one ticket system, and what each priority promises.
section: Guides
order: 16
---

## Plans

| | Free | Developer | Standard | Premium |
|---|---|---|---|---|
| Price per month | 0 | $24 | $100 | $500 |
| Urgent | | | 1 hour | 30 minutes |
| High | | 8 hours | 4 hours | 2 hours |
| Normal | 2 days | 24 hours | 8 hours | 4 hours |
| Low | 3 days | 2 days | 24 hours | 8 hours |
| Open tickets at once | 3 | 10 | 25 | 100 |

Times are the target for the first answer from an engineer, counted around the clock, every day of the week. They are targets we hold ourselves to, not a refund clause. A blank cell means the priority cannot be chosen on that plan.

**Free** covers account, billing and abuse questions and anything that looks like a platform fault. **Developer** adds technical help on any product: setup, sizing, best practice. **Standard** adds urgent tickets for production incidents and help with incidents on managed products. **Premium** gives you a named engineer who knows your setup, a monthly review, and priority during platform incidents.

Paid plans are billed by the hour like everything else, on the team's oldest project, in the team's currency. Change plans at any time from **Support** in the console, with `prgd support plan standard`, or with `PUT /v1/support/plan`. An open ticket keeps the target of the plan it was opened under.

## Tickets

Open a ticket from **Support** in the console, from the terminal, or from the API:

```sh
prgd support new "Server web-1 will not reboot" --body "Reboot has been queued for an hour." --priority high --about server:cm...
prgd support tickets
prgd support show ID
prgd support reply ID "Still stuck after a stop and start."
prgd support close ID
```

Name the server, database, load balancer, domain, bucket or invoice when you can. It must belong to your team, and it lets the engineer open the right thing before writing back.

A ticket is **open** while it waits on us and **answered** while it waits on you. Every answer goes by email to the team owners and to whoever opened the ticket. Replying to an answered or closed ticket reopens it; after 14 days closed, open a new one.

Email works too. Write to **support@progrid.co** from the email address on your account and a ticket opens with the subject line as its title; the reply carries the ticket number. Replying to any ticket email, or writing with `[#123]` in the subject, adds to that ticket. There is no phone line: every request goes through tickets so nothing gets lost.

Agents can open tickets too. The MCP server has a `support_ticket` tool, and the `support:write` scope on an agent token allows it. A ticket opened by a token shows the token's name, so you know which agent asked.

## Events

`ticket.opened`, `ticket.answered`, `ticket.replied`, `ticket.closed` and `support.plan_changed` go through the audit log and webhooks like every other event.
