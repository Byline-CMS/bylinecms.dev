---
title: "Core Document Storage"
path: "core-document-storage"
summary: "How Byline stores documents: typed store tables, field paths, flatten and reconstruct, immutable versioning, the current-version views, and what the model costs you."
---

# Core Document Storage

Companions:
- [Path Grammar](./04-path-grammar.md) — `field_path` on the store rows is one of two field-path notations; that document is the reference for both and for how they relate.
- [Relationships](../04-collections/03-relationships.md) — the first read consumer that spans collections.
- [Document Paths](../04-collections/05-document-paths.md) — `path` was the first system attribute promoted out of the storage layer; it now lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)`.
- [Collection Versioning](../04-collections/08-collection-versioning.md) — schema versioning sits beside, but is independent of, document versioning.
- [Storage benchmark sweep — 2026-04-18](https://github.com/Byline-CMS/bylinecms.dev/blob/develop/benchmarks/storage/results/2026-04-18-storage-cold-summary.md) — the cold-path latency evidence cited below.

## Overview

This document explains where your content actually lives once Byline saves it, and why the storage layer is shaped the way it is. Read it if you are evaluating Byline's data model, writing an adapter, or trying to understand why adding a field to a collection needs no database migration.

### The vocabulary

Five terms carry most of the model. Everything below builds on them.

- **Document**: the core unit of content in Byline — one article, one page. Everything the CMS stores, versions, localizes, and serves is a document. A [collection](../04-collections/index.md) declares what shape a document takes (its fields, workflow, and hooks), so every document is an instance of exactly one collection: the collection is the unit of authoring, the document is the unit of content. A document has a stable id, is never edited in place, and is a tree rather than a flat record — a field can hold a group, a repeating array, or a sequence of blocks.
  - **Document version**: one saved state of a document. Every save inserts a new version; earlier versions stay exactly as they were. "The document" as a reader sees it is really its current version.
  - **Current version**: the most recent non-deleted version of a document, resolved by a database view rather than by a flag you maintain.
- **Store row**: a single field value, stored as one row in one of seven typed tables. A document version is not a record in a table of its own — it is the set of store rows that share its id.
- **Field path**: the dotted string on each store row that says which part of the document tree that value came from, such as `content.0.photoBlock.caption`. It is what lets a flat table hold a nested document.

Byline is document-centric in the same sense as a document store such as MongoDB or CouchDB. The document is what you read, write, version, and serve as a whole, and its shape is owned by your application rather than declared to the database. What differs is what sits underneath. Because a document decomposes into ordinary Postgres rows, you keep the guarantees a relational database provides: foreign keys to related documents, transactions spanning a document and the side tables written with it, typed columns with the full range of Postgres indexes behind your filters and sorts, and one query planner over the whole corpus. The rest of this document describes how those two sets of properties are made to coexist.

Byline persists documents in a **typed entity-attribute-value (EAV) store, partitioned by primitive type**. Seven typed store tables hold every field value, addressed by field path; a meta table holds stable identities for blocks and array items; a versions table carries lifecycle metadata; and a Postgres view materialises the current version per document.

### Why this model

The architecture exists to deliver three properties at once:

1. **Schema changes need no migration.** When you add, remove, or restructure a field on a `CollectionDefinition`, you do not write a database migration. The shape of your data lives in the schema; the database only holds rows. Frameworks that give each collection its own table need a migration for the same change.
2. **Localization is metadata, not schema.** Every store row carries a `locale` column. Switching a field from non-localized to localized is a runtime change, not a schema migration.
3. **Immutable versioning composes naturally.** A new version is an insert of new rows under a new version id. There is no copy-on-write of a JSON blob, no diff to compute against the previous version's columns, and no special handling for partial-version writes.

These compose only because the storage layer treats every field value as a row keyed by version, locale, and field path. Fold them into a per-collection table model and at least one of the three has to give.

The cost of EAV is read-time reconstruction across several tables. That is the model's central risk, it is measured rather than asserted, and the [benchmarks](#indicative-benchmarks) below show where it stays flat and where it does not.

## What happens when you save a document

Before the reference sections, here is one document making the full round trip. Take a `news` collection with a localized `title`, a `category` relation, and a `content` blocks field, and suppose an editor saves the English version.

1. **You call the write path.** The admin interface sends accumulated patches; `@byline/client` sends a whole document. Both land in `document-lifecycle`, which resolves the collection and opens a transaction.
2. **Byline mints a version id.** A new UUIDv7 `document_version_id` is generated. It is time-ordered, so ordering by id orders by creation. The previous version's rows are not touched at any point in what follows.
3. **The document tree is flattened.** `flattenFieldSetData(fields, data, locale)` walks your `CollectionDefinition` alongside the submitted data and emits one `FlattenedFieldValue` per leaf. Compound fields — `group`, `array`, `blocks` — produce no row of their own; only their descendants do.
4. **Each value is routed to its store.** The field's declared type selects the table: `title` to the text store, a `number` to the numeric store, `richText` to the JSON store, the `category` to the relation store. Blocks and array items also emit `store_meta` rows carrying their stable `_id` and `_type`.
5. **Locale is stamped per row.** A localized field writes its locale code (`en`). A non-localized field writes the literal `'all'` — relations included, since relations are never localized. This is why switching a field to localized is a data change rather than a schema change.
6. **Rows are inserted, one round trip per store.** Values are bucketed by store table and inserted in bulk. Locale copy-forward — carrying the untouched `fr` and `de` rows onto the new version — runs as a single batched transaction step, not one per store.
7. **Reading it back reverses the process.** A read selects that version's rows from every store in one `UNION ALL`, and `restoreFieldSetData` walks the schema again to rebuild the tree — picking the correct value column per store, resolving locale, and folding `_id` and `_type` back onto their blocks inline.

The resulting rows for a fragment of that document look like this:

```
field_path                            store      locale   value
──────────────────────────────────────────────────────────────────────────────
title                                 text       en       "Hello, world"
title                                 text       fr       "Bonjour, monde"
category                              relation   all      → target_document_id
content                               —          —        (no row — structure)
content.0._id                         meta       all      "0193…"  (UUIDv7)
content.0._type                       meta       all      "photoBlock"
content.0.photoBlock.caption          text       en       "Sunrise"
content.0.photoBlock.images.0.image   file       all      → file_id, storage_path
content.0.photoBlock.images.0.display boolean    all      true
```

Two things to notice. The `content` blocks field has no row of its own — walking your schema is what tells the reconstructor that `content.0` is a block rather than a value. And identity for that block lives in `store_meta`, never in the value tables, which is what lets patches such as `array.move` and `block.replace` address an item without depending on its position.

## Where the data lives

Every physical table and view is prefixed `byline_`. The prefix is omitted below for readability.

```
documents                          ── logical document, never edited in place
  id                  uuid    pk   ── document_id (UUIDv7, time-ordered)
  collection_id       uuid    fk
  source_locale       text         ── the document's content-locale anchor
  order_key           text         ── optional editorial ordering
  ...

document_versions                  ── one row per saved version, immutable
  id                  uuid    pk   ── document_version_id (UUIDv7)
  document_id         uuid    fk
  collection_id       uuid    fk
  collection_version  int          ── schema version this version was written against
  status              text         ── 'draft' | 'published' | <workflow state>
  is_deleted          bool         ── tombstone for soft delete
  created_by          uuid
  created_at, updated_at

document_paths                     ── per-(document, locale) URL slug, outside the version stream
  document_id         uuid    pk   ── (composite with locale)
  locale              text    pk
  collection_id       uuid    fk
  path                text         ── derived via useAsPath + slugifier
                                   UNIQUE(collection_id, locale, path)
```

Every store table shares the same base columns — `id`, `document_version_id`, `collection_id`, `field_path`, `field_name`, `locale`, `parent_path`, timestamps — and adds its own value columns:

```
store_text       value text, word_count int
store_numeric    number_type, value_integer | value_decimal | value_float
store_boolean    value boolean
store_datetime   date_type, value_date | value_time | value_timestamp_tz
store_json       value jsonb, json_schema, object_keys[]
store_file       file_id, filename, mime_type, file_size, storage_provider,
                 storage_path, image_* metadata, variants jsonb
store_relation   target_document_id, target_collection_id,
                 relationship_type, cascade_delete

store_meta       key text, value text
                 ── stable _id (UUIDv7) and _type for blocks and array items

current_documents             view ── ROW_NUMBER() OVER (PARTITION BY document_id) → rn = 1
current_published_documents   view ── filtered to status='published' first, then ROW_NUMBER
```

The numeric, datetime, and file stores keep several typed columns rather than one, plus a discriminator (`number_type`, `date_type`) so the reconstructor knows which column to read. That is why "seven tables" does not mean "seven `value` columns".

Every store table carries `UNIQUE(document_version_id, field_path, locale)` — the constraint that makes a field value at a path in a locale singular by construction — plus secondary indexes matched to how each store is queried: GIN full-text and btree on `store_text.value`, range indexes on the numeric and datetime columns, and target/reverse-lookup indexes on `store_relation`.

The single source of truth for field type to store table lives at `packages/core/src/storage/field-store-map.ts`:

| Field type                          | Store table       |
|-------------------------------------|-------------------|
| `text`, `textArea`, `select`        | `store_text`      |
| `integer`, `float`, `decimal`       | `store_numeric`   |
| `boolean`, `checkbox`               | `store_boolean`   |
| `date`, `time`, `datetime`          | `store_datetime`  |
| `richText`, `json`, `object`        | `store_json`      |
| `file`, `image`                     | `store_file`      |
| `relation`                          | `store_relation`  |

A contract test enumerates every declared field type so the mapping cannot drift. Both the Postgres adapter (UNION ALL and filter SQL generation) and `@byline/client`'s `parseWhere` consume it.

## How field paths address a tree

Your document is a tree; the store is flat. The field path is the bridge — a dotted key on every store row, built from field names, array and block indices, and block types. `content.0.photoBlock.caption` reads as: the `content` field, its first item, which is a `photoBlock`, and that block's `caption`.

Three rules govern it:

- **Compound fields carry no leaf row.** `group`, `array`, and `blocks` contribute path segments but no value of their own.
- **Identity lives in `store_meta`.** Blocks and array items get a stable `_id` (UUIDv7) and `_type` there, never in the value tables. Position is an accident of the current order; `_id` is not.
- **`_id` is synthetic metadata.** It is never persisted through `flattenFieldSetData` and never treated as a data key by renderers. The flattener emits it; the reconstructor consumes it. `RESERVED_FIELD_NAMES` enforces this at config load.

The full grammar — including the distinction between the instance paths stored here and the declaration paths used in configuration — is specified in [Path Grammar](./04-path-grammar.md).

## Flatten and reconstruct

```
write path:
  document data (tree)
    → flattenFieldSetData(fields, data, locale)      ── storage-flatten.ts
    → FlattenedFieldValue[]
    → bucketed by store type
    → INSERT INTO store_<type> (...) VALUES (...)    ── one round trip per store

read path:
  document_version_id
    → SELECT FROM store_text UNION ALL ...           ── 7-way UNION ALL
    → FlattenedFieldValue[]
    → restoreFieldSetData(fields, rows, locale)      ── storage-restore.ts
    → document data (tree)
```

The reconstructor is **schema-aware**. It walks your `CollectionDefinition.fields`, looks up each row by path, extracts the value from the correct column of the seven candidates, resolves locale (unwrapping `{ en: value }` to `value` for single-locale reads), and reassembles the tree. Meta rows fold in inline — there is no second pass to attach `_id` and `_type`.

The per-store SELECT lists come from a **declarative column manifest** (`storage-store-manifest.ts`). Adding a column to a store table is a one-line manifest change and every SELECT in the UNION ALL updates structurally, so positional mismatches between stores are impossible by construction.

## Why EAV, and what it costs

Three models can back a headless CMS. Byline picked the third, and the tradeoffs are worth stating plainly rather than assuming.

### A table per collection

Each collection becomes its own SQL table, with a column per field. This is what Payload, Strapi, and Directus do.

**Advantages.** Queries are ordinary SQL against ordinary columns, so filtering, sorting, and joining are as fast and as familiar as your database can make them. The schema is self-describing, and existing tooling — reporting, BI, migrations — works without adaptation.

**Disadvantages.** Every schema change is a migration. Adding a field, renaming one, or making one localized means DDL, a deployment step, and a rollback plan. Localization forces a choice between a column per locale, a sidecar table per collection, or a row per locale with a discriminator, and each of those complicates every query. Versioning needs a parallel history table per collection, kept in step with the live one forever.

### One JSON document per version

Each version stores its whole document as a single JSONB blob.

**Advantages.** Reads are a single keyed lookup with no reconstruction. Versioning is trivial — a new blob per version. Schema changes need no migration, since the blob has no fixed shape.

**Disadvantages.** Filtering and sorting on a field inside the blob depends on expression indexes that must be declared per field, which quietly reintroduces the migration step you were avoiding. Partial reads are impossible — fetching a title for a list view deserialises the whole document. There is no type discipline at rest, so a field's type is whatever was last written.

### Typed EAV, partitioned by primitive type

Byline's model: one row per field value, in the table matching that value's primitive type.

**Advantages.** Schema changes need no migration; localization is a column, not a shape; versioning is an insert. Values stay typed at rest, so filters and sorts run against real Postgres types with real indexes — numeric ranges on numeric columns, full-text on text columns. Reads can be pruned to the stores and fields a request actually needs.

**Disadvantages.** Reading a document means reconstructing it across up to seven tables, and reconstruction is schema-aware work rather than a keyed lookup. A write amplifies into one row per leaf field per locale. List views pay for a window function over every version in the collection. These costs are real; the rest of this document measures them.

The honest summary: Byline trades a well-understood read cost for the removal of migrations from the day-to-day loop. That trade is only defensible if the read cost stays bounded, which is what the benchmarks below exist to check.

## Selective field loading

A 7-way UNION ALL is fine for a full document read and wasteful for a list view that only needs `title` and `updatedAt`. Selective field loading prunes both axes — the **store level** (skipping tables the request does not need) and the **field level** (trimming sibling fields out of the reconstructed result).

```
Route loader / @byline/client
  → caller specifies fields: ['title', 'views']
  → resolveStoreTypes(fields, fieldNames)
    → walks compound types recursively (blocks/array/group → child store types)
    → returns Set<StoreType> e.g. { 'text', 'numeric' }
  → adapter builds UNION ALL of only those stores
  → reconstruction trims output to the requested field names
```

For a list view requesting `[title, status, updatedAt]`, six of seven stores are skipped at SQL time. The admin list view derives the field set automatically from `CollectionAdminConfig.columns`, so list pagination never triggers a full document read.

When you omit `fields`, the full 7-way UNION ALL runs. Single-document reads — the edit view, detail reads — take that path by default.

## Versioning

Saved versions are **immutable by default**, identified by a time-ordered UUIDv7 `document_version_id`. Creating a version inserts new rows under the new id; the previous version's rows stay untouched. The `current_documents` view resolves "latest":

```sql
SELECT *,
       ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY id DESC) AS rn
FROM document_versions
WHERE is_deleted = false
```

…then filters to `rn = 1`.

Status changes are the exception: they mutate the existing version row in place. Status is lifecycle metadata rather than content, so publishing a draft does not fork a version.

Locale copy-forward on a versioned write runs as a **single transaction batch**. When only `en` is being written, the seven per-store `INSERT ... SELECT` statements that carry `fr` and `de` rows forward from the previous version run as one round trip, not seven.

## Status-aware reads

Public consumers — `@byline/client` defaults to `status: 'published'` — read through a second view:

```sql
SELECT *,
       ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY id DESC) AS rn
FROM document_versions
WHERE is_deleted = false
  AND status = 'published'                 -- filter BEFORE the window
```

The status filter runs **before** the window function. That ordering is the whole point: a draft saved over a previously published version does not hide the published content, so your public readers keep seeing the last published version until the draft is itself published. The view is the read-side complement of immutable versioning — the current published version is a function of the data, not of editor intent.

The adapter's `readMode?: 'published' | 'any'` threads through `findDocuments`, `getDocumentById`, `getDocumentByPath`, `getDocumentsByDocumentIds`, and `populateDocuments`. Admin paths default to `'any'` (the adapter default); `@byline/client` defaults to `'published'`.

## Changes outside the version stream

Immutable versioning gives content changes a complete, queryable history: every save is a new version row, and the admin **History** view renders that lineage with per-version diffs. Two classes of change deliberately sit **outside** that stream — the [document-level versus version-level](./index.md#3-document-level-vs-version-level) split described in the architecture overview:

1. **Document-level system fields** — `path` (`byline_document_paths`), the editorial `availableLocales` set (`byline_document_available_locales`), and the tree edge (`byline_document_relationships`). You edit these through dedicated **non-versioned** writes (`updateDocumentPath`, `setDocumentAvailableLocales`, `placeTreeNode`) that mint no version and do not reset status. They are document-level and sticky across versions, so gating them behind the publish workflow would falsely imply per-version staging. See [Internationalization](../07-internationalization/index.md), [Document Paths](../04-collections/05-document-paths.md), and [Document Trees](../04-collections/04-document-trees.md).
2. **Status and lifecycle transitions** — these mutate the version row in place rather than forking a version, so a publish → unpublish → re-publish sequence is not independently recorded by the version timeline beyond the current status value.

Dedicated non-versioned lifecycle services pair these changes with the document-level audit log: `updateDocumentSystemFields` records path and advertised-locale changes, `changeDocumentStatus` records explicit status transitions, `unpublishDocument` records a published-to-archived transition when it changes at least one version, and explicit tree mutations record placement changes. Tree-document deletion atomically records child promotion and parent edge removal beside the soft delete.

That database and audit commit is the success boundary. Storage cleanup and post-commit `afterTreeChange` / `afterDelete` failures do not reject or undo the delete; the lifecycle returns `committed-with-side-effect-failures` for reconciliation and logging instead. SDK whole-document updates still write their optional path and locales through version creation rather than the direct system-field audit service, so if you need dedicated before/after audit rows you must use that entry point. The admin surfaces available audit rows as a **Document history** tab beside the version timeline. See [Auditability](../06-auth-and-security/02-auditability.md) for the full reference.

## Indicative benchmarks

These numbers are **development-machine, cold-path, indicative**. They are not a production performance gate. The sweep ran on 2026-04-18 against an Apple M1 Pro MacBook Pro with local Dockerised Postgres 17, default config, no tuning. Reproduction commands and per-scale `EXPLAIN ANALYZE` plans live in [`benchmarks/storage/results/`](https://github.com/Byline-CMS/bylinecms.dev/tree/develop/benchmarks/storage/results).

The fixture is a `bench-articles` collection with 9 fields spanning 5 store tables (text, json, numeric, datetime, boolean) plus a relation to `bench-media`. Every third article carries a hero relation. Each measurement is the median of 50 iterations after 10 warmup iterations.

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

This is the main objection to EAV, and the data falsifies it here. At 100k documents, a cold full reconstruct costs about what a single keyed lookup against a JSON column would. The conclusion is that a **read-cache JSONB column on `document_versions` is not justified work** — the upper bound on any optimisation against a 3 ms baseline is replacing 3 ms with less, which does not pay for the maintenance complexity of a denormalised cache. If a deployment produces evidence to the contrary, the benchmark harness makes reopening the question trivial.

**Batch fetches and populate scale flat.** `getDocumentsByDocumentIds` at batch-50 stays at ~7 ms across all scales; `populateDocuments` depth-2 stays at ~3 ms. Populate's batch-per-depth-per-target-collection strategy works as designed: a deeper graph adds one round trip per level, not an N×M fan-out. Future cross-collection consumers — richtext document-link hydration, multi-relation `hasMany` populate — inherit this property.

**List views are the one query type that scales with N.** `findDocuments` (page, size 20) grows from 6 → 17 → 70 → 129 ms. The growth comes from the `current_documents` view: it materialises a `ROW_NUMBER() OVER (PARTITION BY document_id)` window across every non-deleted version in the collection, then filters to `rn = 1`. Postgres evaluates the full window on every query — no caching, no materialisation.

This is the real inflection point, and it lands well above the scale most Byline deployments reach: 17 ms at 10k, 70 ms at 50k, 130 ms at 100k. For public consumers it is largely moot, because public list views key on filter, sort, and page combinations that cache well at the reverse-proxy tier. If a workload at 500k+ emerges, the answer is **materialising `current_documents` as a table** — trigger-maintained or periodically refreshed — not a per-row JSONB cache.

**Field filter plus sort is the most expensive cold path, and it is sub-linear.** `findDocuments` with `$contains` and a field sort rises 18 → 147 → 282 → 352 ms. Growth slows from 50k to 100k (25% for 2× the data), reflecting the GIN index on `store_text.value` and the fact that the LATERAL sort join is bounded by the filter's result size rather than total document count. 352 ms at 100k is acceptable for an admin search box; for public-facing search at large scale the specific optimisation is a full-text index (`pg_trgm` or `tsvector`), not a general cache layer.

### Why development-machine numbers still tell you something

A production deployment caches at three layers — source (per `document_version_id`), reverse proxy (stale-while-revalidate over rendered pages), and browser (`ETag` derived from `document_version_id`). In steady state, **most reads never reach the storage layer**. The 7-way UNION ALL runs on cache miss.

That makes these numbers less a performance gate than a way to characterise three things that do matter operationally:

1. **Cold-path latency.** The first unique visitor to a new version pays the cost, and it stays low across realistic scales.
2. **Cache stampede behaviour.** Bulk publish and invalidation events push many concurrent misses through storage at once. Per-query cold latency bounds the blast radius — at ~3 ms per single-document read, even a 1000-RPS stampede on a fresh deploy stays manageable on one Postgres connection.
3. **List-view cache-miss path.** Single-document reads key cleanly on `document_version_id`. List views with arbitrary filter and sort combinations have a combinatorial cache-key space and resist aggressive caching, which makes their raw query performance more operationally relevant than single-document read performance.

Production numbers will differ — different hardware, tuned Postgres, real concurrency, real cache behaviour. The *shape* of the cost is the durable finding: flat in document count for single-document reads and batch fetches, growing only on the unfiltered list-view path, which has a well-understood mitigation if it becomes load-bearing.

### What the sweep did not measure

- **Write throughput.** Seed rate appears in the per-scale files for reference (~1,500 docs/sec at 100k) but is not the point of the sweep — Byline writes are editor-driven, not bulk.
- **Warm-cache behaviour.** Caching sits above storage; the sweep exists to characterise the cold path.
- **Concurrent clients.** The root-level `benchmarks/*.txt` files cover HTTP-tier concurrency with autocannon.
- **Plan stability at scale.** Limited to single-iteration `EXPLAIN ANALYZE` captures. A plan-regression test would rerun the same explain periodically and diff it. Future work.
- **Multi-collection graphs.** Populate was exercised with one relation per source. Wider graphs (5–10 relations per source) may scale differently — worth a separate sweep when `hasMany` lands.

## Architectural risks and mitigations

### `current_documents` is the one place that scales with collection size

This is the strategic risk worth tracking. The window function evaluates every non-deleted version on every list-view query. At the scales tested it stays well within acceptable, but the growth is real and roughly linear in non-deleted versions per collection.

**The mitigation** is to materialise `current_documents` as a table — either trigger-maintained on every version insert and update, or refreshed on a cadence the workload tolerates. The view definition and its consumers do not change; the view is replaced by a table of the same shape, so the change stays contained until a workload demands it.

### EAV write amplification at large fan-out

A single update writes one row per leaf field per locale. A document with 50 leaves across 3 locales generates 150 store-row inserts, most of them unchanged carry-forwards from the previous version. Locale copy-forward already collapses the seven per-store `INSERT ... SELECT` statements into one transaction batch, so the dominant cost is rows per document rather than round trips.

**No mitigation planned.** Byline writes are editor-driven and bounded by document size; the worst case is one editor saving one document. If a bulk-import path emerges, the right primitive is a streaming bulk-insert helper beneath `document-lifecycle`, not a change to the model.

### `_id` discipline

The `_id` UUIDv7 on blocks and array items is **synthetic metadata**, not a data key. The flattener emits it from the schema; the reconstructor consumes it. Renderers walking reconstructed data must ignore `_id` keys and never round-trip them as field values. `RESERVED_FIELD_NAMES` enforces this, validated at config load.

## Code map

| Concern                                  | Location                                                                                |
|------------------------------------------|-----------------------------------------------------------------------------------------|
| Field-type → store-table mapping         | `packages/core/src/storage/field-store-map.ts`                                          |
| Flatten                                  | `packages/db-postgres/src/modules/storage/storage-flatten.ts`                           |
| Reconstruct                              | `packages/db-postgres/src/modules/storage/storage-restore.ts`                            |
| Per-store column manifest                | `packages/db-postgres/src/modules/storage/storage-store-manifest.ts`                    |
| Selective field loading                  | `resolveStoreTypes()` in `storage-utils.ts`; partial UNION ALL in `storage-queries.ts`  |
| Document write services                  | `packages/core/src/services/document-lifecycle/` (per-operation modules)                |
| Document read services + `afterRead`     | `packages/core/src/services/document-read.ts`                                           |
| Populate orchestration                   | `packages/core/src/services/populate.ts`                                                |
| `IDocumentQueries` interface             | `packages/core/src/@types/db-types.ts`                                                  |
| Postgres schema                          | `packages/db-postgres/src/database/schema/index.ts`                                     |
| Migrations                               | `packages/db-postgres/src/database/migrations/`                                         |
| Current-version views                    | both views (`byline_current_documents`, `byline_current_published_documents`) and the `byline_document_paths` table ship in the baseline migration `0000_ordinary_rhino.sql`; Drizzle definitions live in `packages/db-postgres/src/database/schema/index.ts` |
| Reserved field names                     | `RESERVED_FIELD_NAMES` exported from `@byline/core`                                     |
| Benchmark harness                        | `benchmarks/storage/harness/`                                                           |
| Benchmark sweep results                  | `benchmarks/storage/results/2026-04-18-storage-cold-summary.md`                         |
</content>
