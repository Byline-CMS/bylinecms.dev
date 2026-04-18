# Storage benchmark — 2026-04-18 sweep summary

Consolidated view of the full 1k → 100k sweep on an Apple M1 Pro
MacBook Pro against local Dockerised Postgres 17. Per-scale raw
outputs (with `EXPLAIN ANALYZE` plans) live alongside this file:

- [`2026-04-18-storage-cold-1k.md`](./2026-04-18-storage-cold-1k.md)
- [`2026-04-18-storage-cold-10k.md`](./2026-04-18-storage-cold-10k.md)
- [`2026-04-18-storage-cold-50k.md`](./2026-04-18-storage-cold-50k.md)
- [`2026-04-18-storage-cold-100k.md`](./2026-04-18-storage-cold-100k.md)

Methodology and rationale are in the folder's
[`README.md`](../README.md).

---

## Environment

- Apple M1 Pro, 32 GB RAM, macOS
- Postgres 17 (Docker), default config (no tuning)
- Byline schema as of commit `4fadec6` (immediately after Phase 5)
- Node v24.14.0
- Per query: 10 warmup iterations discarded, 50 measured iterations

## Fixture

- `bench-articles` collection with 9 fields spanning 5 store tables
  (text, json, numeric, datetime, boolean) + 1 relation to
  `bench-media`
- Media pool size = `max(20, scale / 50)` so relation targets scale
  alongside the primary collection
- Every 3rd article carries a hero relation
- Deterministic content; re-seeding at the same scale produces the
  same fixture

## Seeding throughput (reference only)

| Scale | Elapsed | Rate |
|---:|---:|---:|
| 1,000 | 0.8 s | 1,240 docs/s |
| 10,000 | 7.2 s | 1,386 docs/s |
| 50,000 | 34.7 s | 1,442 docs/s |
| 100,000 | 67.5 s | 1,482 docs/s |

Writes scale linearly with rate slightly improving as the connection
pool warms. 100k seed is ~1 minute — comfortably within "run a
benchmark" territory.

---

## Results — median query latency

All figures are median of 50 measured iterations, in milliseconds.
p95 numbers are in the per-scale files.

| Query | 1k | 10k | 50k | 100k |
|---|---:|---:|---:|---:|
| `getDocumentById` (full reconstruct) | 3.15 | 2.80 | 2.98 | 3.10 |
| `getDocumentById` (select=['title']) | 1.51 | 1.67 | 1.51 | 1.63 |
| `findDocuments` (page 1, size 20) | 6.44 | 16.72 | 69.52 | 128.68 |
| `findDocuments` ($contains title + sort by views) | 17.79 | 147.09 | 282.17 | 351.59 |
| `getDocumentsByDocumentIds` (batch of 50) | 7.43 | 7.10 | 6.85 | 7.09 |
| `populateDocuments` (depth 2, 20 src × 1 rel) | 3.09 | 2.84 | 2.64 | 2.78 |

### What each query exercises

- **`getDocumentById` (full)** — 7-way `UNION ALL` across every
  `store_*` table, full reconstruction. The original concern behind
  "benchmark the UNION ALL at scale."
- **`getDocumentById` (select=['title'])** — selective field loading
  via `resolveStoreTypes()`, touching only `store_text`. Proxy for
  list-view single-column reads.
- **`findDocuments` (page)** — the primary list-view query path
  through `current_documents` with document-level ordering.
- **`findDocuments` ($contains + sort)** — list view plus field-level
  EXISTS subquery plus `LEFT JOIN LATERAL` for field-level sort.
- **`getDocumentsByDocumentIds`** — batch-by-id fetch powering
  `populateDocuments`. Measures whether populate's batch-per-level
  strategy stays cheap at scale.
- **`populateDocuments`** — end-to-end populate, depth 2, against 20
  source documents each with one relation. Fan-out at a realistic
  admin-API-preview shape.

---

## Findings

### 1. Single-document reads scale perfectly flat

Both `getDocumentById` variants held steady (2.80–3.15 ms full,
1.51–1.67 ms title-only) across a 100× increase in document count.
The UNION ALL cost is a function of **fields per document**, not
documents in the collection — exactly what the data model promised.
Selective field loading delivers the expected ~2× speedup by
eliminating six of seven store scans.

**Implication:** the `getDocumentById` cold path is a non-issue at
every scale we tested. The JSONB read-cache column from the original
STORAGE-ANALYSIS open item would be addressing a problem that does
not exist for single-doc reads.

### 2. Batch fetches and populate scale flat

`getDocumentsByDocumentIds` at batch-50 stayed at ~7 ms across all
scales; `populateDocuments` depth-2 stayed at ~3 ms. Populate's
batch-per-depth-per-target-collection strategy is working as
designed: a deeper graph doesn't amplify per-query cost, only adds
one round trip per level.

**Implication:** cross-collection fan-out is cheap. Future richtext
document-link hydration (which reuses `getDocumentsByDocumentIds`)
inherits this property.

### 3. List views are the only query type that scales with N

`findDocuments` (page, size 20) grew from 6 → 17 → 70 → 129 ms. The
growth is driven by the `current_documents` view: it materialises a
`ROW_NUMBER() OVER (PARTITION BY document_id)` window across every
non-deleted version in the collection, then filters to `rn = 1`.
Postgres evaluates the full window each query — no caching, no
materialisation.

This is the **real inflection point**, but it lands at a scale most
Byline deployments will not reach:

- At 10k docs, a full-list query is ~17 ms — still fast.
- At 50k, 70 ms — noticeable but acceptable for admin UIs.
- At 100k, 130 ms — starting to feel slow for admin pagination,
  still under the "feels instant" ceiling most users have.

For public consumers this is largely moot: list views key on filter
/ sort / page combinations that cache well at the reverse-proxy
tier, and the `document_version_id`-keyed source cache handles the
per-document reconstruct underneath.

**Implication:** if a real user emerges with a collection well above
100k, the answer is not the JSONB read-cache column but rather
**materialising `current_documents` as a table** (trigger-maintained
or periodically refreshed). That's a different category of work and
can stay deferred until a real workload demands it.

### 4. Field filter + sort is the most expensive cold path, and sub-linear

`findDocuments` with `$contains` + field sort rose from 18 → 147 →
282 → 352 ms — worst absolute numbers in the mix, but note the
**slowing growth rate** from 50k → 100k (only 25% increase for 2×
data). The EXISTS subquery on `store_text` uses GIN / trigram
potential indexes that Postgres scales well with; the LATERAL sort
join is bounded by the filter's result size.

**Implication:** this is an admin-facing query (editors filtering
the list view). 352 ms at 100k is acceptable for an admin search
box. If it becomes a public query against a very large collection,
full-text search indexes (`pg_trgm` / `tsvector`) are the specific
optimization — not a general cache layer.

### 5. The strategic open item ("benchmark the UNION ALL at scale") can close

The hypothesis that motivated the benchmark was: *"at 100k documents
with 20+ fields each, Postgres will need to scan the required tables
per query even if only 2-3 contain data for a given field subset.
Selective loading reduces the fan-out for list views, but
single-document reads still hit all seven."*

The measurements falsify the worry. Single-document reads at 100k
are 3 ms — the seven-table UNION ALL is cheap because each store's
scan is bounded by `document_version_id = ?` and the index sizes
stay small. The concern was real in the abstract; the data shows
it's not load-bearing at the scales Byline is designed for.

### 6. Read-cache column: deferred indefinitely

A JSONB read-cache column on `document_versions` would speed up
`getDocumentById` full-reconstruct reads. Current cost for that
query: **~3 ms**. The upper bound on any optimization is replacing
3 ms with less. That's not a good return on the complexity of
maintaining a denormalised cache, especially given source-layer
caching (memo on `document_version_id`) already eliminates
near-all production hits on this path.

**Recommendation:** close the "consider a read cache" item in
STORAGE-ANALYSIS as *not needed at projected scale*. If a future
deployment surfaces evidence to the contrary, the benchmark
harness here makes the reopen trivial: rerun at the new scale,
compare, decide.

---

## What we did not measure (and why)

- **Write throughput.** Seed rate is shown above for reference but
  is not the point of the sweep. Byline writes are editor-driven,
  not bulk.
- **Warm-cache behaviour.** Caching sits above storage; the whole
  point of this sweep is cold-path characterisation.
- **Concurrent clients.** The root-level `benchmarks/*.txt` files
  cover HTTP-tier concurrency with autocannon.
- **Plan stability at scale.** Limited to single-iteration
  `EXPLAIN ANALYZE` captures; a plan-regression test would
  periodically rerun the same explain and diff. Future work.
- **Multi-collection graphs.** Populate was exercised with one
  relation per source doc. Wider graphs (5-10 relations per source)
  may show different scaling — worth a separate sweep when
  `hasMany` lands.

---

## How to reproduce

From the repo root:

```sh
# Seed the bench collection at the target scale.
pnpm -F @byline/bench-storage run seed --scale 100000

# Run the query mix, capture to a dated file.
pnpm -F @byline/bench-storage run bench --scale 100000 \
  > benchmarks/storage/results/YYYY-MM-DD-storage-cold-100k.md

# Teardown (cascade-deletes all bench documents).
pnpm -F @byline/bench-storage run seed -- --teardown
```
