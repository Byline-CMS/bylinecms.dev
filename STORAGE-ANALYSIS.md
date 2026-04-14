# Universal Storage (EAV-per-type) — Strategic Analysis

> Last updated: 2026-04-14

## What we've built

A typed EAV system across 7 store tables (`store_text`, `store_numeric`, `store_boolean`, `store_datetime`, `store_json`, `store_file`, `store_relation`) plus `store_meta` for stable block/array-item identities. Documents are flattened via path notation (`content.1.photoBlock.0.display`), written as individual rows, and reconstructed on read via UNION ALL across all 7 tables.

## What it gets right

### 1. The core premise is sound
Zero-migration collection schema changes is a genuinely valuable property for a CMS. Payload, Strapi, Directus — they all require migrations when you add a field. We don't.

### 2. Type-native storage is the right refinement of EAV
Classic EAV stuffs everything into a single `varchar` column. Our typed tables give us native Postgres indexing — `GIN` for full-text on `store_text`, proper `timestamp` range queries on `store_datetime`, numeric comparisons on `store_numeric`. This sidesteps the most common critique of EAV.

### 3. Localization "for free" is elegant
The `locale` column on every store row means switching a field from non-localized to localized requires zero schema changes, zero migrations. This directly delivers on Design Goal #4. Most competing CMS frameworks (Payload included) require a restructuring step for this.

### 4. Immutable versioning composes naturally
Because field values are linked to a `document_version_id`, creating a new version is just inserting new rows. There's no copy-on-write of a JSONB blob. This is the right fit for EAV.

## Where it's costing us

### 1. The 7-table UNION ALL is our biggest long-term risk
Every single-document read executes a 7-way `UNION ALL` with 41 columns each (most `NULL`). List pages run the same UNION ALL (store-filtered when selective field loading kicks in) via `reconstructDocuments` → `getAllFieldValuesForMultipleVersions` with `document_version_id = ANY(...)`. This is fine at prototype scale. At 100k documents with 20-30 fields each (2-3M store rows), Postgres will need to scan the required tables per query even if only 2-3 contain data for a given field subset. Selective loading reduces the fan-out for list views, but single-document reads still hit all seven.

**Mitigation options to evaluate:** (a) a materialized "current document JSONB" cache column that's rebuilt on write — reads become trivial, the EAV remains the source of truth for queries/indexing; (b) `EXPLAIN ANALYZE` benchmarks with seed data at 10k, 50k, 100k documents to find the actual inflection point.

### 2. ~~The template queries are a maintenance hazard~~ — Resolved
Replaced on 2026-04-06 with a generated column manifest. A declarative array of column definitions generates the per-store SELECT lists at runtime. Adding a column is a one-line change; positional mismatches are structurally impossible.

### 3. ~~The locale-copy-forward on versioned writes is O(7 x stores)~~ — Resolved
Resolved 2026-04-08. The per-store `INSERT ... SELECT`s for carrying forward non-active locale rows now run in a single transaction batch — one round trip instead of seven.

### 4. ~~No query-side field filtering yet~~ — Resolved
See [Selective Field Loading](#selective-field-loading-2026-04-06) below.

### 5. ~~Searching is hard-coded to `title`~~ — Resolved
Resolved 2026-04-08. `CollectionDefinition.search.fields` drives the text-search OR; falls back to `['title']` when not configured.

## The strategic question: should we keep it?

**Yes, but with eyes open.** The EAV-per-type approach directly enables our three most differentiating features: zero-migration schema changes, locale-as-metadata, and immutable versioning. Abandoning it for per-collection tables would mean becoming another Payload/Strapi clone — technically simpler but strategically undifferentiated.

However, we need to plan for the read-performance ceiling before it becomes load-bearing.

## Recommended actions

### ~~Near-term — all shipped 2026-04-08~~

1. **Unify query paths** — `getAllFieldValues()` now delegates to the dynamic `getAllFieldValuesForMultipleVersions()` builder; a single-document read uses the same store-filtered UNION ALL as the batch path.
2. **Configurable per-collection search** — `CollectionDefinition.search.fields` drives the text-search OR in `findDocuments()` (falls back to `['title']`).
3. **Locale copy-forward optimization** — the seven per-store `INSERT ... SELECT`s in `createDocumentVersion` now run as a single transaction batch.

### Strategic (open)

#### Benchmark the UNION ALL at scale
Run `EXPLAIN ANALYZE` on the 7-way UNION ALL with realistic data volumes (10k+ documents, 20+ fields each). Know our numbers. The selective field loading work (done) mitigates this for list views, but single-document reads still hit all stores.

#### Consider a read cache
A `jsonb` column on `document_versions` (we already have a `doc` column marked "optionally store the original document") could serve as a write-through cache. Reads hit the JSONB; field-level queries still hit the typed stores. This gives us O(1) document reads while preserving all the EAV benefits for indexing and querying. Evaluate after benchmarking.

### ~~Selective field loading~~ — Done
Implemented 2026-04-06. See [Selective Field Loading](#selective-field-loading-2026-04-06) below.

## Client API — status (2026-04-14)

The client API layer (`@byline/client`, `packages/client/DESIGN.md`) lives above the storage primitives. Design-time interactions with the EAV layer are captured here.

### What the storage system already provides

- **Selective field loading** maps directly to a `select`/`fields` parameter. The `resolveStoreTypes()` → partial UNION ALL → field trimming pipeline is the right primitive.
- **Schema/presentation split** means `CollectionDefinition` is the server-safe authority for validation, field resolution, and relationship metadata. The client API doesn't need to touch `CollectionAdminConfig`.
- **Immutable versioning is invisible** to clients. The `current_documents` view resolves "latest version" — a `find()` call doesn't need version IDs. Version history is a separate, opt-in concern.
- **Patch-based updates stay admin-internal.** The patch system is tied to UI intent (array reordering, block insertion, field-level change tracking). The client API does whole-document or field-level writes, mapping to `createDocumentVersion()` directly.

### Shipped

#### Query builder layer (Phase 2)
`IDocumentQueries.findDocuments()` accepts a declarative spec (document-level filters, `FieldFilter[]` compiled into EXISTS subqueries, `FieldSort` compiled into `LEFT JOIN LATERAL`, and selective field loading). `@byline/client`'s `parse-where.ts` translates the client DSL into these descriptors via the shared `fieldTypeToStore` mapping in `@byline/core`.

#### Shared field→store mapping
`packages/core/src/storage/field-store-map.ts` is the single source of truth: `StoreType`, `ALL_STORE_TYPES`, `fieldTypeToStore` (rich — includes value column), `fieldTypeToStoreType` (derived — adds structure categories). Both the client DSL parser and the db-postgres adapter consume it; a contract test enumerates every declared field type.

#### Narrow metadata + populate primitives
- `IDocumentQueries.getCurrentVersionMetadata()` — hits `current_documents` only for lifecycle operations (status changes) that need `{document_version_id, status, path}` but not the document body.
- `IDocumentQueries.getDocumentsByDocumentIds()` — batch-fetch current versions by logical `document_id`, with optional selective field loading. Scaffolds Phase 3 populate (`store_relation` rows carry `target_document_id`).

### What's still missing

#### Relationship population (Phase 3 — `populate` / `depth`)
`store_relation` stores the link and `getDocumentsByDocumentIds()` is in place, but the orchestration layer is not. Phase 3 adds:
- Resolving relation fields to target collections
- A post-query pass that batches populated documents by depth level (one DB round trip per level, not per relation field)
- `depth` control to prevent runaway recursion and circular-reference tracking
- `populate` nested `select` → forwards to the batch fetch's `fields` param

#### Write path (Phase 4)
`create`, `update`, `delete`, `changeStatus`, `unpublish` — delegate to `document-lifecycle` functions from `@byline/core/services`. No storage changes required; the client handle is a thin shim.

### Impact on current storage code
The storage primitives have already absorbed what Phases 2 + 3 need. Remaining Phase 3 work is pure client-side orchestration (no rewrites).

## Bottom line

The architecture is defensible and genuinely interesting. The dual flatten/reconstruct issue has been resolved — both paths now use the same schema-aware `storage-utils.ts` implementation. The template queries have been replaced with a generated column manifest, and selective field loading is now a first-class capability. Query paths have been unified, search is now configurable per collection, and locale copy-forward runs in a single DB round trip. Phases 1 and 2 of the client API have shipped (read, filter, sort); the field→store mapping is consolidated in `@byline/core` with a contract test. The next client API milestone is relationship population; the next strategic storage priority is benchmarking the UNION ALL and evaluating a read cache.

## Architecture changes (2026-04-06)

### Registry / Dependency Injection
A typed `Registry`/`AsyncRegistry` DI container was ported from another project at Infonomic into to `@byline/core`. This provides compile-time dependency graph validation via TypeScript conditional types. The webapp now initializes via `initBylineCore()` which composes the dependency graph and bridges backward compatibility with the existing `getServerConfig()` global.

### Schema-aware reconstruction
`DocumentQueries` receives `CollectionDefinition[]` at construction time (injected via the registry through `pgAdapter`). On read, it resolves a document's collection UUID to its definition via a cached DB lookup, then passes the schema to `restoreFieldSetData` for type-correct reconstruction. This eliminates the old two-step process (`reconstructFields` + `attachMetaToDocument`) — meta rows (`_id`, `_type` for blocks/arrays) are now converted to `FlattenedFieldValue` entries and handled inline during restoration. Locale resolution (unwrapping `{ en: value }` to `value` for single-locale queries) is also handled inline via the `resolveLocale` parameter.

### Files removed
- `storage-utils-annotated.ts` — unused reference copy
- `attachMetaToDocument` function — meta handled inline by `restoreFieldSetData`
- `reconstructFields` usage in query path — replaced by `restoreFieldSetData`
- Fallback reconstruction path — `CollectionDefinition` is now required, not optional

### Files added
- `packages/core/src/lib/registry.ts` — typed DI container
- `packages/core/src/core.ts` — `initBylineCore()` entry point

### Selective field loading (2026-04-06)

One of the key advantages of EAV over monolithic JSONB storage is that you can read only the fields you need. Selective field loading makes this a first-class capability in the query layer, significantly reducing I/O for list views and API responses that only need a subset of a document's fields.

#### How it works

Selective field loading operates at two levels:

**1. Store-level filtering — skip entire tables**

Each collection field type maps to one of the 7 typed store tables. When a caller requests specific fields (e.g. `title` + `views`), the system resolves those field names to the set of store types they require (`text` + `numeric`) and builds a UNION ALL that queries only those tables — skipping the rest entirely. For a list view that only needs text fields, this eliminates 6 of 7 table scans.

The mapping lives in `storage-store-manifest.ts` as `fieldTypeToStoreType`:

| Field type | Store table |
|---|---|
| `text`, `textArea`, `select` | `store_text` |
| `integer`, `float`, `decimal` | `store_numeric` |
| `boolean`, `checkbox` | `store_boolean` |
| `date`, `time`, `datetime` | `store_datetime` |
| `richText`, `json`, `object` | `store_json` |
| `file`, `image` | `store_file` |
| `relation` | `store_relation` |

Compound field types (`blocks`, `array`, `group`) are walked recursively to collect all child store types. Requesting `content` (a blocks field containing richText, boolean, text, and image sub-fields) correctly resolves to `{ json, boolean, text, file }`.

**2. Field-level trimming — remove sibling fields**

Store-level filtering is coarse-grained. If you request `views` (numeric) but not `price` (also numeric), both come back from `store_numeric`. A post-reconstruction pass trims the document's `fields` object to include only the requested field names. This gives callers a precise projection without building per-field SQL conditions.

#### Where field names come from

The admin list view is the primary consumer. Each collection's `defineAdmin()` config declares which columns appear in the list table. The route loader extracts those field names automatically:

```typescript
// Route loader — apps/webapp/src/routes/.../collections/$collection/index.tsx
const adminConfig = getCollectionAdminConfig(params.collection)
const fields = adminConfig?.columns
  ?.map((c) => String(c.fieldName))
  .filter((name) => collectionDef.fields.some((f) => f.name === name))
```

This respects the schema/admin split: `CollectionDefinition` defines what fields exist; `CollectionAdminConfig` defines which ones the list view needs. Metadata fields like `status` and `updated_at` live on the document version row itself — they don't need store queries.

When no `fields` parameter is provided, the full 7-table UNION ALL executes as before. This keeps single-document reads (edit view, API detail endpoints) unchanged.

#### The data flow

```
Route loader
  → extracts field names from admin column config
  → passes fields[] to server function
    → getDocumentsByPage({ ..., fields })
      → resolveStoreTypes(collectionDef.fields, fields)  → Set<StoreType>
      → getAllFieldValuesForMultipleVersions(ids, locale, storeTypes)
        → builds partial UNION ALL (only needed tables)
      → reconstructDocuments trims output to requested fields
```

#### Key files

| File | Role |
|---|---|
| `storage-store-manifest.ts` | `fieldTypeToStoreType` mapping, `storeSelectList()` generator |
| `storage-utils.ts` | `resolveStoreTypes()`, recursive `collectStoreTypes()` |
| `storage-queries.ts` | Partial UNION ALL builder, field trimming in `reconstructDocuments` |
| `core/@types/db-types.ts` | `fields?: string[]` on `IDocumentQueries.getDocumentsByPage` |

#### Test coverage

- **Unit tests** (`storage-flatten-reconstruct.test.ts`): 6 tests covering `resolveStoreTypes` — text-only fields, mixed types, recursive blocks, recursive arrays, non-existent fields, empty input.
- **Integration tests** (`storage-field-types.test.ts`): Selective loading verifies unrequested fields are absent from the response; full loading verifies all fields present when no filter is applied.

## Progress log

| Date | Change | Notes |
|------|--------|-------|
| 2026-04-05 | Initial analysis | Reviewed full storage layer: schema, flatten, reconstruct, queries, commands |
| 2026-04-06 | Registry/DI + schema-aware reconstruction | Ported Registry from Modulus, unified read/write on new-storage-utils, removed legacy fallback |
| 2026-04-06 | Generated column manifest | Replaced 7 hand-maintained SQL template fragments with declarative column manifest |
| 2026-04-06 | Selective field loading | Store-level UNION ALL filtering + field-level trimming, driven by admin column config |
| 2026-04-08 | Doc refresh + near-term roadmap | Updated CLAUDE.md and STORAGE-ANALYSIS.md; prioritized query unification, configurable search, locale copy-forward optimization |
| 2026-04-08 | Implemented near-term items | Unified query paths, configurable search via `CollectionDefinition.search`, locale copy-forward in single round trip |
| 2026-04-08 | Client API analysis | Documented planned client API layer, query builder needs, relationship population strategy |
| 2026-04-08 | @byline/client Phase 1 | New `packages/client` package with read API: find, findOne, findById, findByPath, count. Delegates to existing IDocumentQueries. Unit + integration tests passing. |
| 2026-04-13 | @byline/client Phase 2 | Field-level filters + sorting via `IDocumentQueries.findDocuments()`. `parse-where.ts` compiles `WhereClause` → `FieldFilter[]`; adapter emits EXISTS subqueries + LEFT JOIN LATERAL. 24 unit + 18 integration tests. |
| 2026-04-14 | Pre-relationships cleanup | Deleted `getDocumentsByPage`, `getAllDocuments`, `getDocumentsByBatch`, `groupAndReconstructDocuments`, backward-compat store manifest exports, `hasFieldLevelConditions`, `CountResult`. Unified `getDocumentsByVersionIds` through `reconstructDocuments`. Tightened `shapeDocument` to throw on missing dates. −506 net lines. |
| 2026-04-14 | Field → store mapping consolidation | Moved `StoreType`, `ALL_STORE_TYPES`, `fieldTypeToStore`, `fieldTypeToStoreType` into `@byline/core` (`src/storage/field-store-map.ts`). db-postgres and @byline/client both consume the shared module; 11 contract tests enumerate every declared field type to prevent drift. |
| 2026-04-14 | Narrow metadata + populate primitives | Added `IDocumentQueries.getCurrentVersionMetadata()` (lifecycle status transitions no longer pay for UNION ALL + meta fetch) and `IDocumentQueries.getDocumentsByDocumentIds()` (batch fetch by logical id — scaffold for Phase 3 populate). Aligned `getDocumentByPath` to return `null` on miss; made `ClientDocument<F>` generic. |
