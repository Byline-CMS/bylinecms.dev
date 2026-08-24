---
title: "Analytics storage, rollups, and operations"
path: "analytics/storage-rollups-and-operations"
summary: "How analytics protects visitor identity, combines raw events with daily rollups, applies retention, and exposes operational signals."
---

# Analytics storage, rollups, and operations

Companions:
- [Analytics](./index.md) — package boundaries and accuracy limits.
- [Analytics configuration](./01-configuration.md) — adapter migrations and task registration.
- [Analytics ingest and deployment](./03-ingest-and-deployment.md) — request validation, trusted request facts, and rate limiting.
- [Testing](../13-testing.md) — repository test modes and database prerequisites.

The PostgreSQL and MySQL adapters implement the same storage contract. The portable runtime owns identity derivation, ingest ordering, rollup orchestration, query semantics, and retention; each adapter owns SQL, transactions, and its independent migration stream.

## Daily visitor identity

The first accepted event in each UTC day creates a cryptographically random 32-byte installation salt. Concurrent application instances insert-if-absent and read the winning row, so every instance uses the same salt for that installation and day.

The runtime calculates:

```text
HMAC-SHA-256(daily salt, canonical(client address, user agent))
```

The canonical encoding length-prefixes both UTF-8 components. The raw client address exists only in request scope and is absent from the storage interface, logs, and database schema.

The hash links events only within one installation and UTC day. Yesterday's salt remains long enough for rollup and clock-skew grace; older salts are destroyed. Deleting a salt prevents later recovery of its request identity, while already computed hashes remain comparable inside their original day.

Visitor totals over several days are sums of daily unique counts, not a cross-day distinct count.

## Raw events and cardinality

An accepted event stores the server timestamp, event kind, source, normalized path, visitor hash, normalized referrer host, and optional country. It stores no payload site identifier, client timestamp, complete referrer URL, or raw client address.

Path and referrer aggregates default to 1,000 distinct values per day. Overflow becomes `__other__`. Views are summed, and visitor totals are recomputed across the union of overflow visitor hashes so one visitor does not become several visitors merely by touching several overflow values. Site and country aggregates are naturally bounded.

## Rollup task

The default `analytics.rollup` task runs hourly and processes complete UTC days through yesterday. It reads the rollup cursor, rebuilds a bounded number of days transactionally, advances the cursor only with a successful rebuild, and asks the scheduler for an immediate follow-up when catch-up work remains.

Rebuilding a day is idempotent. A failed or interrupted run can repeat without double counting. The task also takes a metrics snapshot even when ingest has been idle.

Monitor the ordinary recurring-task health entry for `analytics.rollup`. A cursor behind yesterday indicates catch-up work. [Recurring tasks](../11-scheduling/01-recurring-tasks.md) describes leases, heartbeat, backoff, and the external-cron alternative.

## Retention

Raw events are retained for 90 days by default. Salts older than yesterday are removed after rollup convergence.

Path and referrer aggregate retention is independently configurable. `null` retains those aggregate strings indefinitely. A finite value cannot be shorter than the longest dashboard period, currently 90 days. Site and country aggregate rows contain no unbounded URL-like strings.

Deleting raw events does not automatically rewrite an already completed aggregate. Maintenance tooling must call `rebuildDay()` for each affected day after `deleteEvents()` so the aggregate converges on the retained events.

## Queries and dashboard stitching

Dashboard queries combine completed aggregate days with unrolled raw days, including today. The boundary follows the rollup cursor, avoiding both a reporting gap and double counting.

Use the portable runtime rather than driver-specific SQL:

```ts
const summary = await analytics.getSummary({
  from: '2026-08-01',
  to: '2026-08-22',
})

const pages = await analytics.getTopPaths({
  kind: 'page',
  from: '2026-08-01',
  to: '2026-08-22',
  limit: 20,
})
// pages.rows holds the ranked slice; pages.total is the number of distinct
// paths in the period, so an interface can say "top 20 of 143" rather than
// presenting a truncated list as the whole set.
```

The admin module registers `analytics.read` and `analytics.maintain`. Optional TanStack server functions protect summary and dimension queries with the read ability and protect deletion and rebuild operations with the maintenance ability. The dashboard appears only when an analytics runtime is registered and the current administrator can read it.

## Privacy notice and exclusion

A deployment's privacy notice should describe its actual installation policy, consent choice, event fields, daily pseudonymous identity, raw-event retention, aggregate retention, and visitor-exclusion instructions.

`createAnalyticsPrivacyStatement()` returns configurable starting text. Pass the public operator name, deployment-specific exclusion instructions, and the configured path and referrer retention periods. The returned operator reminder states that the template is not legal advice.

The standard browser-local exclusion flag is `localStorage["byline-analytics-ignore"]`. The agent reads it before transport and sends nothing when it exists. An admin application on another origin cannot change that public-origin setting without an integration on the public site.

## Operational signals

Application counters distinguish accepted events from each visible drop reason: origin, ignored path, bot, prefetch, missing host-resolved identity, replay, and malformed input. These are policy and validation outcomes rather than persistence health.

Rate-limit rejections happen before Node when a platform, Cloudflare, nginx, or another proxy enforces them. They appear in that layer's telemetry, not in the application counters. An operations runbook must name each configured source.

A storage failure is a third signal class. The event handler returns an empty `503`, and the browser does not retry. The application logs a fixed persistence-failure message with an allowlisted database error code. It does not attach the database error object, request address, visitor hash, event path, or payload.

## Conformance tests

`@byline/analytics-conformance` is private workspace tooling rather than a runtime dependency. It runs identical behavioral tests against PostgreSQL and MySQL, including migrations, UTC-day boundaries, concurrent salt creation, capped rollups, `__other__` visitor semantics, raw-plus-rollup query stitching, deletion, rebuilds, and retention.

The suite exists because TypeScript can prove that both adapters expose the same methods but cannot prove that their SQL has the same time-zone, transaction, aggregation, or deletion behavior. Applications do not install it.
