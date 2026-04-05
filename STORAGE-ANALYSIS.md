# Universal Storage (EAV-per-type) — Strategic Analysis

> Last updated: 2026-04-06

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
Every single-document read executes a 7-way `UNION ALL` with 41 columns each (most `NULL`). For list pages, the paginated query in `getDocumentsByPage` first selects current document IDs, then calls `reconstructDocuments` -> `getAllFieldValuesForMultipleVersions`, which runs the same 7-way UNION ALL with `document_version_id = ANY(...)`. This is fine at prototype scale. At 100k documents with 20-30 fields each (2-3M store rows), Postgres will need to scan 7 tables per query even if only 2-3 contain data for a given collection. The query planner can't skip tables in a `UNION ALL`.

**Mitigation options to evaluate:** (a) a materialized "current document JSONB" cache column that's rebuilt on write — reads become trivial, the EAV remains the source of truth for queries/indexing; (b) `EXPLAIN ANALYZE` benchmarks with seed data at 10k, 50k, 100k documents to find the actual inflection point.

### 2. The template queries (`storage-template-queries.ts`) are a maintenance hazard
Every store table addition or column change requires updating 7 synchronized SQL template fragments, each with 41 positional columns padded with NULLs. This is the single most fragile file in the codebase. One positional mismatch silently corrupts data. The read path now uses schema-aware reconstruction via `restoreFieldSetData`, but the UNION ALL templates still power the raw SQL queries that feed it.

### 3. The locale-copy-forward on versioned writes is O(7 x stores)
The `createDocumentVersion` method runs 7 separate `INSERT ... SELECT` statements to carry forward non-active locale rows from the previous version. This is correct but expensive — for a document with content in 5 locales, saving one locale triggers 7 full-table INSERT-SELECTs filtered by version ID. At scale this will dominate write latency. Consider a single raw SQL statement that does this in one pass, or a stored procedure.

### 4. No query-side field filtering yet
The README mentions Design Goal #5 (reduced field selection for list views). The current implementation always reconstructs the full document. For a list view showing just `title` + `status` + `publishedOn`, we're still fetching and reconstructing every field across all 7 store tables. This is where EAV normally shines (you *can* query just `store_text WHERE field_name = 'title'`) — but the architecture isn't leveraging it yet.

### 5. Searching is hard-coded to `title`
The `getDocumentsByPage` search path joins `textStore` and filters on `field_name = 'title'` with `ilike`. This will need to become configurable per-collection (searchable fields), and extending it to multi-field search across store types will compound the UNION ALL complexity.

## The strategic question: should we keep it?

**Yes, but with eyes open.** The EAV-per-type approach directly enables our three most differentiating features: zero-migration schema changes, locale-as-metadata, and immutable versioning. Abandoning it for per-collection tables would mean becoming another Payload/Strapi clone — technically simpler but strategically undifferentiated.

However, we need to plan for the read-performance ceiling before it becomes load-bearing.

## Recommended actions

### 1. Benchmark now
Run `EXPLAIN ANALYZE` on the 7-way UNION ALL with realistic data volumes (10k+ documents, 20+ fields each). Know our numbers.

### 2. Consider a read cache
A `jsonb` column on `document_versions` (we already have a `doc` column marked "optionally store the original document") could serve as a write-through cache. Reads hit the JSONB; field-level queries still hit the typed stores. This gives us O(1) document reads while preserving all the EAV benefits for indexing and querying.

### 3. Invest in selective field loading
The EAV structure naturally supports fetching only specific fields — this should be a first-class capability in the query layer, not a future TODO.

## Bottom line

The architecture is defensible and genuinely interesting. The dual flatten/reconstruct issue has been resolved — both paths now use the same schema-aware `new-storage-utils.ts` implementation. The remaining risks are the 7-table UNION ALL read performance at scale and the fragile `storage-template-queries.ts` templates. Addressing read-performance caching and selective field loading are the next strategic priorities.

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

## Progress log

| Date | Change | Notes |
|------|--------|-------|
| 2026-04-05 | Initial analysis | Reviewed full storage layer: schema, flatten, reconstruct, queries, commands |
| 2026-04-06 | Registry/DI + schema-aware reconstruction | Ported Registry from Modulus, unified read/write on new-storage-utils, removed legacy fallback |
