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

An accepted event is written immediately to the raw-event table. Completed UTC
days are later copied into aggregate counts; the raw row is not moved or
replaced during rollup. Dashboard reads use aggregates through the rollup cursor
and raw events after it, so today remains visible before maintenance runs.

## Daily visitor identity

The first accepted event in each UTC day creates a cryptographically random 32-byte installation salt. Concurrent application instances insert-if-absent and read the winning row, so every instance uses the same salt for that installation and day.

The runtime calculates:

```text
HMAC-SHA-256(daily salt, canonical(client address, user agent))
```

The canonical encoding length-prefixes both UTF-8 components. The raw client address exists only in request scope and is absent from the storage interface, logs, and database schema.

The hash links events only within one installation and UTC day. Yesterday's salt remains long enough for rollup and clock-skew grace; older salts are destroyed. Deleting a salt prevents later recovery of its request identity, while already computed hashes remain comparable inside their original day.

Visitor totals over several days are sums of daily unique counts, not a cross-day distinct count.

## Raw event storage

The SQL adapters insert accepted events into `byline_analytics_event`. Each row
has exactly these analytics fields:

| Column | Current value |
|---|---|
| `id` | Database-generated row identity. |
| `occurred_at` | Application-server time captured when ingest begins. PostgreSQL stores `timestamptz`; MySQL receives an explicitly serialized UTC `datetime(6)`. |
| `kind` | `page` or `download`, copied from the validated body. |
| `source` | `beacon` for every event produced by the current browser ingress. `redirect` and `cdnlog` are reserved schema values with no current producer. |
| `path` | Root-relative normalized pathname, with repeated slashes collapsed, query and fragment removed, and length capped at 512 Unicode code points. |
| `visitor_hash` | A 64-character lowercase daily HMAC digest. |
| `referrer_host` | External lowercase host, including an explicit port when present, capped at 255 Unicode code points, or `null`. Same-installation and invalid referrers are `null`. |
| `country` | Trusted uppercase two-letter code, or `null`. |

The row contains no `site_id` because one registered runtime represents one
analytics installation. It also contains no raw client address, user agent,
cookie, full referrer URL, query string, fragment, client timestamp, or
cross-day identifier. The storage adapter's `AnalyticsEvent` input type cannot
receive the raw address or user agent.

The current path behavior deliberately combines URL variants. For example,
`/products//camera?campaign=spring#reviews` is stored as
`/products/camera`. If browser search/hash counting is enabled, those changes
can add views to that row, but the variants cannot be recovered from storage.

`byline_analytics_salt` stores one UTC `day` and one 32-byte salt. It is the
only additional identity material used by the raw event process.

## Daily aggregates and cardinality

Rollup creates four kinds of aggregate row:

| Table | Input events | Stored measures | Cardinality and retention class |
|---|---|---|---|
| `byline_analytics_daily_site` | All events for one UTC day. | Page-event `views`, distinct page-event `visitors`, and download-event `downloads`. | One row per day; retained indefinitely. |
| `byline_analytics_daily_path` | Both event kinds, grouped independently by `kind` and `path`. | Event count as `views` and distinct daily visitor hashes as `visitors`. | Top configured paths per day and kind, plus optional `__other__`; configurable aggregate retention. |
| `byline_analytics_daily_referrer` | Page events with a non-null external referrer. | Page views and distinct daily visitor hashes. | Top configured hosts per day, plus optional `__other__`; configurable aggregate retention. |
| `byline_analytics_daily_country` | Page events with a valid country. | Page views and distinct daily visitor hashes. | Naturally bounded country set; retained indefinitely. |

A visitor who only produces a download is included in that download path's
daily uniques but not in the site-wide page-visitor total. Referrer and country
reports describe page events only. A day with no events still gets a zeroed
site row and advances the cursor; its other aggregate tables have no rows.

Path and referrer cardinality caps default to 1,000. For each completed day,
the driver ranks grouped keys by views descending and then key ascending. It
keeps the first `cap` rows and folds the rest into the reserved `__other__`
row. The path cap is applied separately to pages and downloads, so one day can
store up to `cap + 1` path rows for each kind. A configured cap must be an
integer of at least 20, matching the current dashboard's ranked-list size.

The overflow row's views are the sum of every overflow event. Its visitors are
recomputed as the distinct visitor hashes across the complete overflow union;
they are not the sum of the discarded rows' visitor counts. One person who
visits three overflow paths therefore contributes one overflow visitor for
that day. Raw paths and referrer hosts can never use the reserved value, and
the database constraints enforce that boundary.

## Rollup task

The default `analytics.rollup` task runs hourly and processes complete UTC days through yesterday. It reads `byline_analytics_rollup_state.last_complete_day`, rebuilds at most seven days per invocation by default, and asks the scheduler for an immediate follow-up when catch-up work remains.

Each day uses one database transaction. The driver deletes that day's previous
four aggregate sets, recalculates them from retained raw events, and advances
the cursor only after all inserts succeed. First enablement begins with the
earliest retained raw-event day, or yesterday when no raw events exist.

Rebuilding a day is idempotent. A failed or interrupted run can repeat without double counting. The task also takes a metrics snapshot even when ingest has been idle.

Monitor the ordinary recurring-task health entry for `analytics.rollup`. A cursor behind yesterday indicates catch-up work. [Recurring tasks](../11-scheduling/01-recurring-tasks.md) describes leases, heartbeat, backoff, and the external-cron alternative.

## Retention

The current retention rules are:

| Data | Current rule |
|---|---|
| Raw events | Fixed 90-day policy. Maintenance deletes rows before the start of the UTC day 90 days before today. There is currently no raw-event retention option. |
| Daily salts | Keep today and yesterday; delete salts older than yesterday. |
| Daily site totals | Retain indefinitely. |
| Daily country totals | Retain indefinitely. |
| Daily path totals | `pathRetentionDays: null` retains indefinitely by default; a finite value prunes older rows. |
| Daily referrer totals | `referrerRetentionDays: null` retains indefinitely by default; a finite value prunes older rows. |
| Rollup cursor and migration ledger | Retain as operational state. |

A finite path or referrer period cannot be shorter than the longest fixed-day
dashboard period, currently 90 days. Year-to-date and all-time reports do not
make that floor unbounded: the dashboard labels a ranked dimension when its
finite retention begins after the selected report. Site and country aggregates
have no unbounded URL-like strings and are not pruned. Aggregate rows contain
no visitor hash. Path and referrer strings can nevertheless contain
application-specific identifiers, so installations whose URL design exposes
such values should choose finite aggregate retention.

Pruning runs only after rollup has caught up through yesterday. The scheduler
therefore does not discard a raw day before creating its aggregate record.
WAF, bot, and proxy protections improve input quality and bound abuse, but they
do not alter these retention rules.

Increasing a finite path or referrer retention period cannot restore aggregate
rows that a shorter policy already pruned. Before widening either period or
changing it to `null`, restore the missing rows from a backup or accept that the
newly exposed earlier interval is incomplete. Report coverage is calculated
from the current configuration; changing that configuration does not recreate
historical data.

Deleting raw events does not automatically rewrite an already completed aggregate. Maintenance tooling must call `rebuildDay()` for each affected day after `deleteEvents()` so the aggregate converges on the retained events.

## Queries and dashboard stitching

Dashboard queries combine completed aggregate days with unrolled raw days, including today. The boundary follows the rollup cursor, avoiding both a reporting gap and double counting.

The admin dashboard offers inclusive 7-, 30-, and 90-UTC-day ranges ending
today, with 30 days as the default. Year to date begins on January 1 in UTC.
All time begins at the earliest day present in either
`byline_analytics_daily_site` or the retained raw-event table; a new empty
installation uses today, so it still produces a valid inclusive range.

`analytics.getReportCoverage()` returns three independently meaningful
boundaries. `summaryFrom` is the earliest day available to headline and country
reports. `pathsFrom` covers page and download rankings, and `referrersFrom`
covers referrer rankings. With the default indefinite aggregate retention, all
three begin together. With finite path or referrer retention, the corresponding
ranked cards display “Data from …” when the selected range begins earlier. The
headline figures and country report remain all-time; the interface does not
mislabel the shorter dimension as covering the whole range.

Storage queries continue to return complete daily rows. The dashboard passes an
explicit chart granularity into its renderer: fixed ranges stay daily;
year-to-date and moderate all-time histories use consecutive seven-day buckets;
all-time histories longer than 732 days use UTC calendar months. Each bucket
carries its actual `from`, `to`, and day count. Coarse visitor values are labelled
as sums of daily uniques rather than as distinct visitors for the bucket.

Use the portable runtime rather than driver-specific SQL:

In server-only application code such as `src/analytics-report.ts`:

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
// queryable paths in the period, so an interface can say "top 20 of 143"
// rather than presenting a truncated list as the whole set.
```

`getSummary()` returns one row for every requested UTC day, including zeroed
days. Its overall figures sum the daily rows. Every visitor result—site, path,
referrer, or country—is therefore a sum of daily unique counts rather than a
distinct person count across the complete period.

The current dashboard requests 20 pages, 20 downloads, and 20 referrers. The
portable API defaults to 20 and accepts limits from 1 through 100; it does not
offer pagination. Country queries have no top-N limit and return the complete
stored country set sorted by views.

Ranked path and referrer queries return `{ rows, total }`. `rows` is ordered by
period views descending and then key ascending. `total` is the number of
distinct queryable keys after grouping the period but before applying the
requested limit. The dashboard displays “Top 20 of 143” only when
`total > rows.length`.

For unrolled days, every raw key can contribute to `total`. For completed days,
keys past that day's cardinality cap no longer exist individually and the
single `__other__` key counts as one. Consequently, `total` describes the
retained/queryable set, not the number of original URLs before rollup, and it
can decrease when a high-cardinality raw day is rolled up. The view totals
still reconcile because `__other__` retains the overflow counts. The dashboard
labels that row “Everything past the daily cap” rather than rendering it as a
real page or host.

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

`@byline/analytics-conformance` is private workspace tooling rather than a runtime dependency. It runs identical behavioral tests against PostgreSQL and MySQL, including migrations, UTC-day boundaries, concurrent salt creation, capped rollups, `__other__` visitor semantics, earliest-reportable-day discovery, raw-plus-rollup query stitching across a year boundary, deletion, rebuilds, and retention.

The suite exists because TypeScript can prove that both adapters expose the same methods but cannot prove that their SQL has the same time-zone, transaction, aggregation, or deletion behavior. Applications do not install it.
