# Storage Benchmarks

Indicative numbers for the EAV-per-type storage layer (7-way `UNION ALL`
over `store_text`, `store_numeric`, `store_boolean`, `store_datetime`,
`store_json`, `store_file`, `store_relation`, plus `store_meta`) at
realistic document counts.

---

## Why these benchmarks exist

Byline CMS workloads are **read-heavy but highly cachable**. A production
deployment will typically cache at three layers:

- **Source** — the resolved document body, naturally keyed by
  `document_version_id` (immutable per version). A single materialisation
  can serve millions of requests before the version is superseded.
- **Reverse proxy** — stale-while-revalidate over the rendered page
  response, so even cache expiry events don't force a synchronous
  storage hit.
- **Browser** — `ETag` headers derived from `document_version_id`
  provide trivial 304 responses on repeat visits.

In steady state, therefore, **most reads never touch the storage layer
at all**. The 7-way `UNION ALL` runs only on cache miss.

That makes these benchmarks less about a production performance gate
and more about three things:

1. **Cold-path latency.** The first unique visitor to a new version
   pays the cost. We want this to feel snappy, not glacial.
2. **Cache stampede behaviour.** Bulk publish / invalidation events
   can briefly push many concurrent misses through storage at once.
   Knowing per-query cold latency bounds cache-stampede blast radius.
3. **List-view cache-miss path.** Single-document reads key cleanly
   on `document_version_id`, but list views with arbitrary
   filter/sort combinations have a combinatorial cache-key space and
   are harder to cache as aggressively — making their raw query
   performance more operationally relevant.

They also serve as a **fit-for-purpose indicator** for users evaluating
Byline: "can this architecture handle my site shape?" Publishing
reproducible numbers lets a prospective user answer that themselves.

A typical Byline deployment is well under 10,000 documents, often
counting versions. We benchmark higher than that deliberately — if
performance only becomes interesting at 50k+, most deployments never
approach the inflection point, and that itself is a useful thing to
publish.

---

## Scope

**In scope:**

- Cold-query latency against a realistic collection schema that
  exercises 5+ of the 7 store tables.
- Per-query timing distributions (median, p95) under a deterministic
  warmup → measurement protocol.
- `EXPLAIN (ANALYZE, BUFFERS)` output for the primary query shapes,
  so future work can inspect plan stability.
- Scales from 1k to 100k documents, tracking how latency curves
  move.

**Out of scope:**

- Warm-cache / reverse-proxy / browser-cache benchmarks — those
  concern whole-application delivery, not the storage layer.
- Concurrent-client load tests. The root `benchmarks/*.txt` files
  already cover HTTP-tier concurrency with autocannon.
- Multi-host / network-tier numbers — environment-dependent, not
  storage-architecture information.
- Write throughput. Byline writes are editor-driven; bulk-import
  paths are a separate concern.

---

## Platform

All runs in this folder are executed on an **Apple M1 Pro MacBook Pro**
against a local Dockerised Postgres 17. This is a deliberate choice:
it's a widely-recognised developer machine, fast enough to surface
genuine performance characteristics but nothing like a tuned
production DB host.

**Treat the absolute numbers here as indicative, not authoritative.**
What matters is:

- the **shape of the curve** as document count scales
- the **relative cost** of each query type at a given scale
- the **ratio** between selective and full-reconstruction reads

Anyone considering a production deployment should re-run these same
harness scripts on their target infrastructure — the methodology
transfers even when the machine doesn't.

---

## Collection schema

A single `bench-articles` collection, plus a small `bench-media`
collection to provide relation targets. The article schema spans five
of the seven store tables so no single store becomes an outlier:

| Field | Type | Store |
|---|---|---|
| `title` | text | `store_text` |
| `slug` | text | `store_text` |
| `summary` | textArea | `store_text` |
| `body` | richText | `store_json` |
| `views` | integer | `store_numeric` |
| `rating` | float | `store_numeric` |
| `published_at` | datetime | `store_datetime` |
| `featured` | checkbox | `store_boolean` |
| `hero` | relation → bench-media | `store_relation` |

That's ~9 store rows per document, plus ~1 media document per 50
articles (for relation targets), plus the row in `document_versions`.

---

## Query mix

Each measured across **10 warmup iterations → 50 measured iterations**,
reported as median and p95:

| Query | What it exercises |
|---|---|
| `getDocumentById` (full) | 7-way `UNION ALL` cold path, full reconstruction |
| `getDocumentById` (select = ['title']) | Selective field loading, one store |
| `findDocuments` (page 1, size 20) | Primary list-view path |
| `findDocuments` with `$contains` + sort by numeric | Field filter + LATERAL sort join |
| `getDocumentsByDocumentIds` (batch of 50) | Populate-style batch fetch |
| `populateDocuments` depth 2, 20 source docs × 1 relation | Cross-collection fan-out |

---

## How to run

Prerequisites:

- Docker Postgres running (`cd postgres && ./postgres.sh up -d`).
- `POSTGRES_CONNECTION_STRING` in either `packages/db-postgres/.env`
  or exported in the shell. The harness picks it up via `dotenv`.
- Migrations applied (`pnpm drizzle:migrate`).

Seed and measure one scale:

```sh
pnpm tsx benchmarks/storage/harness/seed.ts --scale 10000
pnpm tsx benchmarks/storage/harness/run-bench.ts --scale 10000
```

`seed.ts` is idempotent-ish: it tears down the bench collections if
they already exist, then reseeds. Safe to rerun.

`run-bench.ts` writes human-readable output to stdout. Pipe it to a
dated file in `results/`:

```sh
pnpm tsx benchmarks/storage/harness/run-bench.ts --scale 10000 \
  > results/2026-MM-DD-storage-cold-10k.md
```

Sweep a full range in one invocation:

```sh
for n in 1000 10000 50000 100000; do
  pnpm tsx benchmarks/storage/harness/seed.ts --scale $n
  pnpm tsx benchmarks/storage/harness/run-bench.ts --scale $n
done > results/2026-MM-DD-storage-cold-sweep.md
```

Teardown without reseeding:

```sh
pnpm tsx benchmarks/storage/harness/seed.ts --teardown
```

---

## Interpreting results

A healthy shape looks like:

- **Linear-ish scaling** on list queries with the count. Sub-linear if
  indexes and `LIMIT` kick in.
- **Near-flat** on `getDocumentById` — the query touches O(fields),
  not O(documents).
- **Selective field loading ~4-6× faster** than full reconstruction
  when only one store table is hit. Bigger gap is better.
- **Populate depth-N ≈ N × single-doc latency**, since each depth
  level batches.

Watch for:

- A knee in `findDocuments` latency around some document count. If
  this appears well inside the realistic range, the JSONB read-cache
  column noted in [`docs/CORE-DOCUMENT-STORAGE.md`](../../docs/CORE-DOCUMENT-STORAGE.md)
  becomes justified work rather than speculative.
- Plan changes in `EXPLAIN ANALYZE` — index scans flipping to
  sequential scans at larger sizes. Such flips usually indicate a
  missing or unused index.
- Runaway growth in the `UNION ALL` count query. Counting against the
  view is O(documents) today; if it dominates, look at cached counts
  via the future `getDocumentCountsByStatus` style primitive.

---

## Results

Each dated file in `results/` captures one sweep's worth of numbers,
the platform it ran on, and any observations. The harness writes
these as markdown so they render directly on GitHub.

Current results:

- **[2026-04-18 sweep summary](./results/2026-04-18-storage-cold-summary.md)** — 1k / 10k / 50k / 100k on M1 Pro. Single-doc reads and populate stay flat (≈3 ms, ≈7 ms batch) at all scales; list views are the only query type that scales with N. Per-scale raw output (with `EXPLAIN ANALYZE`) alongside.

---

## Relationship to top-level benchmarks

The top-level `benchmarks/*.txt` files measure **HTTP-tier
concurrency** with autocannon — they answer "how many req/s can the
whole stack handle?" The files here measure **storage-tier latency
per query** — they answer "what does a single cold cache miss
actually cost?" Both are useful, and they're deliberately separate
because conflating them would hide whatever layer actually dominates.
