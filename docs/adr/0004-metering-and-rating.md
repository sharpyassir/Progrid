# ADR 0004 — Metering pipeline and hourly rating

**Status**: accepted · **Date**: 2026-09-25

## Decision

1. Host agents publish `usage.v1` events to NATS every minute per resource
   (`prgd.usage`), containing `resourceType`, `resourceId`, `quantity`, `unit`, `at`.
2. `BillingModule.MeteringConsumer` writes them into `UsageEvent`, a TimescaleDB
   hypertable partitioned on `at`.
3. An hourly job (`RatingService.rollupHour`) aggregates events into `UsageRecord`
   (one row per resource per hour) and rates them against `Price` rows:
   `hourlyPrice = monthlyPrice / BILLING_HOURS_PER_MONTH (672)`, and the sum for a
   resource in a calendar month is capped at `monthlyPrice`.
4. Monthly `Invoice` is generated from `UsageRecord` in the project's currency
   (SAR for Saudi accounts, USD otherwise). Money is stored as integer minor units
   (kuruş / cents) — never floats.
5. **Currency.** The price book is USD only. `FxService` keeps a USD→SAR rate (`FxRate`, refreshed hourly from `FX_PROVIDER_URL`, settable by an admin). Pricing, spend checks and hourly rating convert at the rate in force at that moment, so lira prices follow the market while dollar prices stay fixed. Usage records store the converted amount in the team currency.
6. Spend limits (`ApiToken.spendCapMinor`, `Project.spendLimitMinor`) are checked
   in the API before starting any workflow that adds cost.

Control-plane-created resources (a server that is `active`) are also metered by a
fallback ticker in the control plane, so a lost agent heartbeat cannot make a running
server free — the agent's events are authoritative when present (dedup on
`resourceId + minute`).
