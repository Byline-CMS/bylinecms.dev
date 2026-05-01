# Core Document Storage

> Companions:
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — the first read consumer that spans collections.
> - [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — the first system attribute promoted out of the EAV layer onto `documentVersions`.
> - [COLLECTION-VERSIONING.md](./COLLECTION-VERSIONING.md) — schema versioning sits beside, but is independent of, document versioning.
> - [Storage benchmark sweep — 2026-04-18](../benchmarks/storage/results/2026-04-18-storage-cold-summary.md) — the cold-path latency evidence cited below.

## Overview

Byline persists documents in a **typed entity-attribute-value (EAV) store partitioned by primitive type**. Seven typed `store_*` tables hold all field values, addressed by a custom path notation; `store_meta` holds stable identities for blocks and array items; `documentVersions` carries lifecycle metadata; and a Postgres view materialises the "current" version per document.

The architecture exists to deliver three differentiating properties at once:

1. **Zero-migration schema changes.** Adding, removing, or restructuring a field on a `CollectionDefinition` does not require a database migration. The shape of the data is in the schema; the database holds rows. Other CMS frameworks (Payload, Strapi, Directus) require migrations because each collection is its own table.
2. **Localization as metadata, not as schema.** Every store row carries a `locale` column. Switching a field from non-localized to localized is a runtime change, not a schema migration.
3. **Immutable versioning that composes naturally.** A new document version is an insert of new rows keyed by a new `document_version_id`. There is no copy-on-write of a JSONB blob, no diff to compute against the previous version's columns, and no special handling for partial-version writes.

These three properties only compose because the storage layer treats every field value as a row keyed by `(document_version_id, locale, path, value)`. Folding them into a per-collection table model would force any one of them to give.

The cost of EAV — read-time reconstruction across multiple tables — is the central concern, and the [benchmark evidence](#indicative-benchmarks) below shows it staying flat where it matters at the scales Byline is designed for.

## Data model

```
documents                          ── logical document, never edited in place
  id                  uuid    pk   ── document_id (UUIDv7, time-ordered)
  collection_id       uuid    fk
  ...

document_versions                  ── one row per saved version, immutable
  id                  uuid    pk   ── document_version_id (UUIDv7)
  document_id         uuid    fk
  collection_id       uuid    fk
  collection_version  int          ── schema version this version was written against
  status              text         ── 'draft' | 'published' | <workflow state>
  path                text         ── derived via useAsPath + slugifier
  schema_path         text         ── stable system path
  created_at, updated_at, deleted_at

store_text         (document_version_id, locale, path, value text)
store_numeric      (document_version_id, locale, path, value numeric)
store_boolean      (document_version_id, locale, path, value boolean)
store_datetime     (document_version_id, locale, path, value timestamptz)
store_json         (document_version_id, locale, path, value jsonb)
store_file         (document_version_id, locale, path, value jsonb)   ── StoredFileValue + variants
store_relation     (document_version_id, locale, path,
                    target_document_id, target_collection_id,
                    relationship_type, cascade_delete)

store_meta         (document_version_id, locale, path, key text, value text)
                                   ── stable _id (UUIDv7) and _type for blocks/array items

current_documents             view ── ROW_NUMBER() OVER (PARTITION BY document_id) → rn = 1
current_published_documents   view ── filtered to status='published' first, then ROW_NUMBER

admin_*                            ── separate auth subsystem; see AUTHN-AUTHZ.md
```

Indexes follow the access pattern: every `store_*` table has `(document_version_id, locale, path)` covering the dominant point lookup, and per-store secondary indexes (GIN on `store_text.value`, btree on `store_numeric.value` and `store_datetime.value`) for filter/sort queries.

The single-source field-type → store-table mapping lives at `packages/core/src/storage/field-store-map.ts`:

| Field type                          | Store table       |
|-------------------------------------|-------------------|
| `text`, `textArea`, `select`        | `store_text`      |
| `integer`, `float`, `decimal`       | `store_numeric`   |
| `boolean`, `checkbox`               | `store_boolean`   |
| `date`, `time`, `datetime`          | `store_datetime`  |
| `richText`, `json`, `object`        | `store_json`      |
| `file`, `image`                     | `store_file`      |
| `relation`                          | `store_relation`  |

A contract test enumerates every declared field type to prevent the mapping from drifting. Both the Postgres adapter (UNION ALL + filter SQL generation) and `@byline/client`'s `parseWhere` consume it.

## Path notation

A document is a tree; the EAV is flat. The bridge is a dotted-path key on every store row:

```
title                                       text         "Hello, world"
content                                     blocks       (no leaf row — structure)
content.0._id                               meta         "0193..."  (UUIDv7)
content.0._type                             meta         "photoBlock"
content.0.photoBlock.caption                text         "Sunrise"
content.0.photoBlock.images.0._id           meta         "0193..."
content.0.photoBlock.images.0.image         file         { fileId, storagePath, ... }
content.0.photoBlock.images.0.display       boolean      true
```

Notable features:

- **Block / array stable identities** live in `store_meta` as `_id` (UUIDv7) and `_type`, never in the value tables. This is what lets the patch system (`array.move`, `array.remove`, `block.replace`) refer to items without depending on positional index.
- **`_id` is synthetic metadata.** It is never persisted via `flattenFieldSetData` and never treated as a data key in renderers. The flattener emits it; the reconstructor consumes it.
- **Compound types (`group` / `array` / `blocks`) carry no leaf row themselves** — only their descendants do. Walking the schema is what tells the reconstructor that `content.0` is a block, not a value.

## Flatten and reconstruct

```
write path:
  document data (tree)
    → flattenFieldSetData(definition, data)         ── packages/db-postgres/.../storage-utils.ts
    → FlattenedFieldValue[]
    → bucketed by store type
    → INSERT INTO store_<type> (...) VALUES (...)   ── one round trip per store

read path:
  document_version_id
    → SELECT FROM store_text UNION ALL ...          ── 7-way UNION ALL
    → FlattenedFieldValue[]
    → restoreFieldSetData(definition, rows, locale)
    → document data (tree)
```

The reconstructor is **schema-aware**. It walks `CollectionDefinition.fields`, looks up each row by path, performs type-correct value extraction (the right column out of the seven candidates), resolves locale (unwrapping `{ en: value }` to `value` for single-locale queries), and re-assembles the tree. Meta rows are folded inline — there is no second pass for `_id` / `_type` attachment.

The per-store SELECT lists are generated from a **declarative column manifest** (`storage-store-manifest.ts`). Adding a new column to one of the store tables is a one-line change to the manifest; the per-store SELECTs that compose the UNION ALL update structurally. Positional mismatches between stores are impossible by construction.

## Selective field loading

A 7-way UNION ALL is acceptable for a full document read; it is wasteful for a list view that only needs `title` and `updatedAt`. Selective field loading prunes both axes — the **store-level** UNION ALL (skipping tables a request doesn't need) and the **field-level** projection (trimming sibling fields out of the reconstructed result).

```
Route loader / @byline/client
  → caller specifies fields: ['title', 'views']
  → resolveStoreTypes(definition, fields)
    → walks compound types recursively (blocks/array/group → child store types)
    → returns Set<StoreType> e.g. { 'text', 'numeric' }
  → adapter builds UNION ALL of only those stores
  → reconstructDocuments trims output to the requested field names
```

For a list view requesting `[title, status, updatedAt]`, six of seven stores are skipped at SQL time. The admin list view extracts the field set automatically from `CollectionAdminConfig.columns`; no full document read happens for list pagination.

When `fields` is omitted, the full 7-way UNION ALL runs as before. Single-document reads (edit view, API detail endpoints) take that path by default.

## Versioning

Saved versions are **immutable by default** and identified by a UUIDv7 `document_version_id` (time-ordered). Creating a new version inserts new rows keyed by the new id; the old version's rows stay untouched. The `current_documents` view resolves "latest" via:

```sql
SELECT *,
       ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC, id DESC) AS rn
FROM document_versions
WHERE deleted_at IS NULL
```

…then filters to `rn = 1`. Status changes mutate the existing version row in place — `status` is lifecycle metadata, not content, so there is no need to fork a new version when a draft becomes published.

Locale copy-forward on versioned writes runs in a **single transaction batch** — when only the `en` locale is being written, the seven per-store `INSERT ... SELECT`s that carry forward `fr` / `de` / etc. rows from the previous version run as one round trip, not seven.

## Status-aware reads

Public consumers (the in-process `@byline/client` defaulting to `status: 'published'`) read through a second view, `current_published_documents`:

```sql
SELECT *,
       ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC, id DESC) AS rn
FROM document_versions
WHERE deleted_at IS NULL
  AND status = 'published'                 -- filter BEFORE the window
```

The status filter runs **before** the window function, so a draft saved over a previously-published version does not hide the published content — public readers continue to see the last published version until the new draft is itself published. The view is the read-side complement of the immutable-versioning property: the "current published version" is genuinely a function of the data, not of editor intent.

The adapter's `readMode?: 'published' | 'any'` parameter threads through `findDocuments`, `getDocumentById`, `getDocumentByPath`, `getDocumentsByDocumentIds`, and `populateDocuments`. Admin paths default to `'any'` (the adapter default); `@byline/client` defaults to `'published'`.

## Indicative benchmarks

Numbers below are **development-machine, cold-path, indicative**. They are not a production performance gate. The full sweep was run on 2026-04-18 against an Apple M1 Pro MacBook Pro with local Dockerised Postgres 17, default config, no tuning. Reproduction commands and per-scale `EXPLAIN ANALYZE` plans live alongside [`benchmarks/storage/results/`](../benchmarks/storage/results/).

The fixture is a `bench-articles` collection with 9 fields spanning 5 store tables (text, json, numeric, datetime, boolean) plus a relation to `bench-media`. Every 3rd article carries a hero relation. Each measurement is the median of 50 iterations after 10 warmup iterations.

### Median query latency (ms)

| Query | 1k | 10k | 50k | 100k |
|---|---:|---:|---:|---:|
| `getDocumentById` (full reconstruct) | 3.15 | 2.80 | 2.98 | 3.10 |
| `getDocumentById` (select=`['title']`) | 1.51 | 1.67 | 1.51 | 1.63 |
| `findDocuments` (page 1, size 20) | 6.44 | 16.72 | 69.52 | 128.68 |
| `findDocuments` (`$contains` title + sort by views) | 17.79 | 147.09 | 282.17 | 351.59 |
| `getDocumentsByDocumentIds` (batch of 50) | 7.43 | 7.10 | 6.85 | 7.09 |
| `populateDocuments` (depth 2, 20 src × 1 rel) | 3.09 | 2.84 | 2.64 | 2.78 |

### What the data says

**Single-document reads scale flat.** `getDocumentById` holds at ~3 ms full-reconstruct across a 100× increase in document count. The 7-way UNION ALL cost is a function of *fields per document*, not *documents in the collection* — exactly what the data model promises. Selective field loading cuts that to ~1.6 ms by eliminating six store scans.

This is the main concern the EAV model was supposed to have, and the data falsifies it. At 100k documents, the cold-path full reconstruct costs about as much as a single keyed lookup against a 7-row JSON column would. The conclusion is that a **read-cache JSONB column on `document_versions` is not justified work** — the upper bound on any optimisation against a 3 ms baseline is replacing 3 ms with less, which doesn't pay for the maintenance complexity of a denormalised cache. If a future deployment surfaces evidence to the contrary, the benchmark harness makes the reopen trivial.

**Batch fetches and populate scale flat.** `getDocumentsByDocumentIds` at batch-50 stays at ~7 ms across all scales; `populateDocuments` depth-2 stays at ~3 ms. Populate's batch-per-depth-per-target-collection strategy is working as designed: a deeper graph adds one round trip per level, not an N×M fan-out. Future cross-collection consumers (richtext document-link hydration, multi-relation `hasMany` populate) inherit this property.

**List views are the one query type that scales with N.** `findDocuments` (page, size 20) grows from 6 → 17 → 70 → 129 ms. The growth is driven by the `current_documents` view: it materialises a `ROW_NUMBER() OVER (PARTITION BY document_id)` window across every non-deleted version in the collection, then filters to `rn = 1`. Postgres evaluates the full window each query — no caching, no materialisation.

This is the real inflection point, but it lands well above the scale most Byline deployments will reach: 17 ms at 10k, 70 ms at 50k, 130 ms at 100k. For public consumers it's largely moot — public list views key on filter / sort / page combinations that cache well at the reverse-proxy tier. If a real workload at 500k+ emerges, the answer is **materialising `current_documents` as a table** (trigger-maintained or periodically refreshed), not a per-row JSONB cache. That work stays deferred until a real workload demands it.

**Field filter + sort is the most expensive cold path, and sub-linear.** `findDocuments` with `$contains` + field sort rises 18 → 147 → 282 → 352 ms. The growth rate slows from 50k → 100k (only 25% increase for 2× data), reflecting the GIN-index potential on `store_text.value` and the fact that the LATERAL sort join is bounded by the filter's result size, not the total document count. 352 ms at 100k is acceptable for an admin search box; for a public-facing search at very large scale, full-text indexes (`pg_trgm` / `tsvector`) are the specific optimisation, not a general cache layer.

### Why these numbers matter even though they're development-machine

A production Byline deployment will cache at three layers — source (per `document_version_id`), reverse proxy (stale-while-revalidate over rendered pages), and browser (`ETag` derived from `document_version_id`). In steady state, **most reads never touch the storage layer at all**. The 7-way UNION ALL runs only on cache miss.

That makes the benchmarks above less a production performance gate and more a way to characterise three things that *do* matter operationally:

1. **Cold-path latency.** The first unique visitor to a new version pays the cost. The data shows this stays snappy across realistic scales.
2. **Cache stampede behaviour.** Bulk publish / invalidation events can briefly push many concurrent misses through storage at once. Per-query cold latency bounds the stampede blast radius — at ~3 ms per single-doc read, even a 1000-RPS stampede on a fresh deploy stays manageable on one Postgres connection.
3. **List-view cache-miss path.** Single-document reads key cleanly on `document_version_id`; list views with arbitrary filter/sort combinations have a combinatorial cache-key space and are harder to cache aggressively. List-view raw query performance is therefore more operationally relevant than single-doc-read raw performance.

Production numbers will differ — different hardware, tuned Postgres, real concurrency, real cache behaviour. But the *shape* of the cost is what the data shows: flat in document count for single-doc reads and batch fetches, growing only on the unfiltered list-view path that has a well-understood mitigation if it becomes load-bearing.

### What we did not measure (and why)

- **Write throughput.** Seed rate is in the per-scale files for reference (~1,500 docs/sec at 100k) but isn't the point of the sweep — Byline writes are editor-driven, not bulk.
- **Warm-cache behaviour.** Caching sits above storage. The whole point of the sweep is cold-path characterisation.
- **Concurrent clients.** The root-level `benchmarks/*.txt` files cover HTTP-tier concurrency with autocannon.
- **Plan stability at scale.** Limited to single-iteration `EXPLAIN ANALYZE` captures. A plan-regression test would periodically rerun the same explain and diff. Future work.
- **Multi-collection graphs.** Populate was exercised with one relation per source. Wider graphs (5–10 relations per source) may show different scaling — worth a separate sweep when `hasMany` lands.

## Architectural risks and mitigations

### `current_documents` is the one place that scales with collection size

This is the strategic risk worth tracking. The window function evaluates every non-deleted version every list-view query. At the scales tested it stays well within acceptable, but the growth is real and roughly linear in non-deleted versions per collection.

**Prepared mitigation, not yet built:** materialise `current_documents` as a table — either trigger-maintained on every `documentVersions` insert/update, or periodically refreshed at a cadence the workload tolerates. The view definition and its consumers don't have to change; the view is replaced by a table of the same shape. The work is deferred until a real workload demands it; the benchmark harness makes the trigger to reopen specific.

### EAV write amplification at large fan-out

A single `update` writes one row per leaf field per locale. A document with 50 leaves across 3 locales generates 150 store-row inserts — most of them unchanged carry-forwards from the previous version. The locale copy-forward optimisation already collapses the seven per-store `INSERT ... SELECT`s into a single transaction batch, so the dominant cost is rows-per-document rather than round-trips.

**No mitigation planned.** Byline writes are editor-driven and bounded by document size; the worst case is a single editor saving a single document. If a future bulk-import path emerges, the right primitive is a streaming bulk-insert helper that sits beneath `document-lifecycle`, not a model change.

### `_id` discipline

The `_id` UUIDv7 on blocks and array items is **synthetic metadata**, not a data key. The flattener emits it from the schema; the reconstructor consumes it. Renderers that walk reconstructed data must ignore `_id` keys and never round-trip them as field values. This is enforced by `RESERVED_FIELD_NAMES` and validated at config load.

## Code map

| Concern                                  | Location                                                                                |
|------------------------------------------|-----------------------------------------------------------------------------------------|
| Field-type → store-table mapping         | `packages/core/src/storage/field-store-map.ts`                                          |
| Flatten / reconstruct                    | `packages/db-postgres/src/modules/storage/storage-utils.ts`                             |
| Per-store column manifest                | `packages/db-postgres/src/modules/storage/storage-store-manifest.ts`                    |
| Selective field loading                  | `resolveStoreTypes()` in `storage-utils.ts`; partial UNION ALL in `storage-queries.ts`  |
| Document write services                  | `packages/core/src/services/document-lifecycle.ts`                                      |
| Document read services + `afterRead`     | `packages/core/src/services/document-read.ts`                                           |
| Populate orchestration                   | `packages/core/src/services/populate.ts`                                                |
| `IDocumentQueries` interface             | `packages/core/src/@types/db-types.ts`                                                  |
| Postgres schema                          | `packages/db-postgres/src/database/schema/index.ts`                                     |
| Migrations                               | `packages/db-postgres/src/database/migrations/`                                         |
| `current_documents` views                | migration `0000_*.sql` (current) + `0001_*.sql` (current_published)                     |
| Reserved field names                     | `RESERVED_FIELD_NAMES` exported from `@byline/core`                                     |
| Benchmark harness                        | `benchmarks/storage/harness/`                                                           |
| Benchmark sweep results                  | `benchmarks/storage/results/2026-04-18-storage-cold-summary.md`                         |
