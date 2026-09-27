---
title: Service level agreement
description: The availability we commit to for each service, and the credit you receive when we miss it.
updated: 27 September 2026
---

This agreement is part of the [Terms of service](/legal/terms) and applies to paid resources on accounts in good standing.

## Commitments

| Service | Monthly availability |
|---|---|
| Servers (network and host availability) | 99.9% |
| Block volumes and object storage | 99.9% |
| Load balancers | 99.9% |
| Managed databases with 3 nodes | 99.95% |
| Managed databases with 1 node | 99.5% |
| Kubernetes control plane with 3 nodes | 99.95% |
| App Platform | 99.9% |
| Control plane: console and API | 99.9% |

Availability is measured per calendar month as the share of minutes in which the service was reachable from the platform edge. A minute counts as unavailable when the resource cannot be reached because of a fault on our side for the whole minute.

## What is not covered

- Scheduled maintenance announced at least 72 hours in advance, up to 4 hours a month, placed outside Saudi business hours where possible.
- Faults inside your server or application: the operating system, your software, your configuration, a full disk, or a firewall rule you set.
- Suspension for non payment or a breach of the [Acceptable Use Policy](/legal/acceptable-use).
- Events outside our reasonable control, such as upstream network failures beyond our providers, attacks that exceed our mitigation capacity, or force majeure.
- Beta and preview features.

## Service credit

When a service misses its commitment, you receive credit on the next invoice for that resource:

| Monthly availability | Credit |
|---|---|
| Below the commitment, down to 99.0% | 10% of that month's charge for the resource |
| Below 99.0%, down to 95.0% | 25% |
| Below 95.0% | 50% |

Claim within 30 days of the end of the month by writing to billing@progrid.sa with the resource ids and the times you observed. We check against our monitoring and apply the credit within 10 business days. Credit is the only remedy for missing a commitment and is not paid in cash.

## Support response

Support plans carry their own first response targets, listed on the [support page](/docs/support). Those are targets, not availability commitments, and are not covered by service credit.

## Status

Incidents and maintenance are published on the status page and, for incidents affecting your resources, by email to the team owners.
