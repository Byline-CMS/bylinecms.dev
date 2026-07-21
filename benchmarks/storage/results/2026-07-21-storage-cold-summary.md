# Storage benchmark — 2026-07-21 sweep summary

Second full 1k → 100k sweep, run on the same Apple M1 Pro MacBook
Pro against local Dockerised Postgres 17. This one is here to answer
"what changed since the [2026-04-18 baseline](./2026-04-18-storage-cold-summary.md)?"
Per-scale raw outputs (with `EXPLAIN ANALYZE` plans) live alongside:

- [`2026-07-21-storage-cold-1k.md`](./2026-07-21-storage-cold-1k.md)
- [`2026-07-21-storage-cold-10k.md`](./2026-07-21-storage-cold-10k.md)
- [`2026-07-21-storage-cold-50k.md`](./2026-07-21-storage-cold-50k.md)
- [`2026-07-21-storage-cold-100k.md`](./2026-07-21-storage-cold-100k.md)

---

## Environment

Effectively unchanged from the baseline, so the deltas below are
schema/query changes, not machine noise:

| | 2026-04-18 | 2026-07-21 |
|---|---|---|
| Machine | Apple M1 Pro, 32 GB | Apple M1 Pro, 32 GB |
| Postgres | 17 (Docker, untuned) | 17 (Docker, untuned) |
| Node | v24.14.0 | v24.15.0 |
| Protocol | 10 warmup / 50 measured | 10 warmup / 50 measured |

The fixture (`bench-articles`, 9 fields over 5 store tables + 1
relation to `bench-media`, deterministic content) is identical.

---

## Results — median query latency vs baseline

Median of 50 measured iterations, milliseconds. `Δ` is the
2026-07-21 figure relative to 2026-04-18.

| Query | 1k | 10k | 50k | 100k |
|---|---|---|---|---|
| `getDocumentById` (full reconstruct) | 3.15 → 3.28 | 2.80 → 3.57 | 2.98 → 3.71 | 3.10 → 3.46 |
| `getDocumentById` (select=['title']) | 1.51 → 1.57 | 1.67 → 1.71 | 1.51 → 1.62 | 1.63 → 1.60 |
| `findDocuments` (page 1, size 20) | 6.44 → **8.59** | 16.72 → **32.18** | 69.52 → **134.91** | 128.68 → **275.62** |
| `findDocuments` ($contains + sort by views) | 17.79 → **24.75** | 147.09 → **162.99** | 282.17 → **455.08** | 351.59 → **530.34** |
| `getDocumentsByDocumentIds` (batch of 50) | 7.43 → 7.44 | 7.10 → 7.07 | 6.85 → 7.10 | 7.09 → 6.99 |
| `populateDocuments` (depth 2, 20 src × 1 rel) | 3.09 → 2.77 | 2.84 → 3.17 | 2.64 → 2.91 | 2.78 → 3.24 |

Approximate multipliers at 100k: page list **≈ 2.1×**, filter+sort
**≈ 1.5×** (≈ 1.6× at 50k). Everything else is within run-to-run
noise.

---

## Findings

### 1. Single-doc reads, batch, and populate are unchanged

`getDocumentById` (both variants), `getDocumentsByDocumentIds`, and
`populateDocuments` all sit on top of their April numbers — flat
across all four scales, differences under a millisecond and inside
noise. Every conclusion from finding #1/#2 of the baseline still
holds: these paths are O(fields), not O(documents), and the
seven-table UNION ALL cold path remains a non-issue.

### 2. List views regressed ≈ 2×, and the cause is a view-shape change

The plain page-list query roughly doubled at every scale (6 → 9,
17 → 32, 70 → 135, 129 → 276 ms). The filter+sort query rose in step
(most at 50k/100k). The `EXPLAIN` plans pin it precisely.

The `current_documents` view (now `byline_current_documents`) gained
a join. Its definition today is:

```sql
WITH sq AS (
  SELECT ..., row_number() OVER (PARTITION BY document_id ORDER BY id DESC) AS rn
  FROM byline_document_versions WHERE is_deleted = false
)
SELECT sq.*, byline_documents.order_key, byline_documents.source_locale
FROM sq
JOIN byline_documents ON byline_documents.id = sq.document_id
WHERE sq.rn = 1;
```

`order_key` and `source_locale` are **document-grain** columns —
they moved out of the version stream since April (the same split that
gave us non-versioned `updateDocumentPath` / `setDocumentAvailableLocales`
and `source_locale`-based default-locale switching). The view now
has to reunite them with each current version.

In the plan, that join lands as a **`Nested Loop` with 100,000
iterations** into `byline_documents` (`Index Scan using
byline_documents_pkey ... loops=100000`), evaluated *before* the
`ORDER BY … LIMIT 20`. Shared-buffer hits jumped accordingly:

| | 2026-04-18 100k | 2026-07-21 100k |
|---|---:|---:|
| page-list buffers (shared hit) | 97,602 | 498,825 |
| page-list execution time | 104 ms | 202 ms |

The window-aggregate half of the plan is unchanged (~80 ms, same
`Incremental Sort` + `WindowAgg`). The entire ~2× is the new
per-current-version lookup into `byline_documents`.

**This is not a bug** — it is the cost of the document-grain /
version split, and the view is the correct place to reunite the two
grains. But because the join is applied across the whole collection
before pagination, list views now pay an O(N) document-grain lookup
on every cold query. It compounds the pre-existing O(N)
`ROW_NUMBER()` window that finding #3 of the baseline already flagged.

### 3. The materialisation recommendation is now better-justified

Baseline finding #3 said: if a collection climbs well past 100k, the
answer is **materialising `current_documents` as a table**
(trigger-maintained or periodically refreshed) rather than a read
cache. This sweep adds weight to that. A materialised
current-documents table would fold the `byline_documents` join into
the stored row and erase both the window recompute and the new
nested-loop join in one move.

A cheaper interim option worth checking: whether the planner can be
coaxed to apply the `byline_documents` join *after* the `LIMIT`
(join only the ≤ 20 surviving rows). The current view forces the
join before pagination because `order_key`/`source_locale` are
projected through `sq`; a lateral join in the caller, or selecting
those columns only for the paginated set, may recover most of the
regression without a materialised table. Worth a spike before
committing to materialisation.

### 4. Still comfortably inside the design envelope

Absolute numbers remain fine for the scales Byline targets: 32 ms
page-list at 10k, and single-doc/populate reads (the paths that
dominate public delivery and cache-miss cost) are untouched. The
regression matters for **admin list pagination on large
collections** — 276 ms at 100k is past "instant" — and for
anyone stress-testing far above typical deployment size. It does not
change the "fit for purpose" answer for a sub-10k deployment.

---

## What to do with this

> **Decision (2026-07-21): accepted as-is for the target scale.** At
> the sizes Byline actually manages (typical deployment well under
> 10k documents, where page-list is ~32 ms), the regression is not
> perceptible and the public cache-miss paths are untouched. The
> deferred-join fix (finding #3) is understood and tracked, but is
> not worth the added query complexity speculatively — it becomes
> justified work only if a real large-collection deployment reports
> sluggish admin list pagination. Tracked in
> [#40](https://github.com/Byline-CMS/bylinecms.dev/issues/40)
> (deferred `byline_documents` join in the list-view path).

- **No immediate action required.** The regression is confined to
  list-view cold queries and does not affect the cache-miss paths
  that matter most in production.
- **Track it.** If an admin surfaces a large collection and reports
  sluggish list pagination, this is the cause and finding #3 is the
  fix.
- **Cheap experiment first.** Before materialisation, test moving the
  `byline_documents` join after the `LIMIT` in the list-view path.

---

## How to reproduce

From the repo root (or `benchmarks/storage`):

```sh
# Full sweep, per-scale dated files:
for n in 1000 10000 50000 100000; do
  pnpm -F @byline/bench-storage run seed --scale $n
  pnpm -F @byline/bench-storage run bench --scale $n \
    > benchmarks/storage/results/YYYY-MM-DD-storage-cold-<label>.md
done

# Teardown (cascade-deletes all bench documents):
pnpm -F @byline/bench-storage run seed -- --teardown
```
