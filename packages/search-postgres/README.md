# @byline/search-postgres

The built-in PostgreSQL full-text `SearchProvider` for Byline CMS. It combines
the portable multilingual analyzer from `@byline/search-analysis` with a
weighted, GIN-indexed `tsvector`, providing ranked search with **zero new
infrastructure** and reusing the existing PostgreSQL connection.

It consumes the type-enriched `SearchDocument` that core assembles
(`buildSearchDocument`) and stores one weighted row per
`(collection_path, document_id, locale)`: body fields → `A`–`D` by their
declared `boost`, facet **terms** → `C` (folded into the searchable vector),
with facet **ids** and filterable scalars kept as `jsonb` for future
aggregation and filtering. A collection's title remains display-only unless
its identity field is also declared in `search.body`.

See
[`docs/06-search/06-postgres-and-mysql.md`](../../docs/06-search/06-postgres-and-mysql.md)
for the built-in provider comparison and operational reference.

## Install

```sh
pnpm add @byline/search-postgres
```

`pg` is a peer dependency — you already have it via `@byline/db-postgres`.

## Register

The provider reuses the host's existing pool (`db.pool` from `pgAdapter`), so
the index lives in the same database with no second connection:

```ts
import { pgAdapter } from '@byline/db-postgres'
import { postgresSearch } from '@byline/search-postgres'
import { defineServerConfig } from '@byline/core'

const db = pgAdapter({ connectionString, collections, defaultContentLocale })

defineServerConfig({
  db,
  search: postgresSearch({ pool: db.pool }),
  // …
})
```

A collection opts into indexing through its `search` config
(`{ body, facets, filters, zones }`); `initBylineCore()` fails fast if a
collection opts in but no provider is registered.

## Schema & migrations

**This driver owns its schema.** It is *not* part of your app's Drizzle
migration stream — it ships its own numbered SQL files in
[`migrations/`](./migrations) and tracks what it has applied in its own
`byline_search_migrations` table. There are three ways to apply them; pick per
environment.

### Portable-analysis cutover

The portable-analysis release replaces the original native PostgreSQL search
schema directly. There is no in-place compatibility migration: search data is
a disposable projection of published documents. Before deploying this version
over an older `@byline/search-postgres` installation, drop only the three
driver-owned tables, reapply `0001_init.sql`, and rebuild each searchable
collection:

```sql
DROP TABLE IF EXISTS byline_search_index_metadata;
DROP TABLE IF EXISTS byline_search_documents;
DROP TABLE IF EXISTS byline_search_migrations;
```

This does not remove CMS documents. After applying the new schema, run the
normal `client.reindex()` workflow so the portable index is reconstructed from
published versions.

### 1. Run the SQL by hand (locked-down / managed Postgres)

The numbered files are the source of truth and are DBA-reviewable:

```sh
psql "$DATABASE_URL" -f node_modules/@byline/search-postgres/migrations/0001_init.sql
```

### 2. Call `migrate()` deliberately (recommended for production)

```ts
import { migrate } from '@byline/search-postgres'

const { applied } = await migrate(db.pool, { log: (m) => logger.info(m) })
// applied: [1]  (empty when already up to date)
```

Run it as a deploy/release step, before the app serves traffic. Idempotent and
transactional per file.

### 3. `autoMigrate` at boot (development convenience)

```ts
search: postgresSearch({ pool: db.pool, autoMigrate: true })
```

Ensures pending migrations at construction. Handy in dev; in production prefer
option 2 so startup is deterministic and DDL permissions are explicit.

## Capabilities

```ts
provider.capabilities
// { facets: false, typoTolerance: false, semantic: false,
//   bm25: false, weighting: true, highlights: true,
//   fullText: {
//     nativeAnalysis: false, portableAnalysis: true,
//     allTerms: true, anyTerms: true,
//     minimumShouldMatch: true, phrase: true
//   } }
```

The `tsvector` + `ts_rank` floor supports per-field **weighting** and all shared
full-text matching policies. Ranked rows are highlighted from stored original
body text through the shared portable token offsets, so snippets preserve the
source spelling while matching normalized and expanded terms. Facet *data* is
indexed, but facet *aggregation* queries, structured `where` filtering, fuzzy
matching, BM25 ranking, and semantic/vector retrieval are follow-ups. The
capability flags let consumers enable only supported behavior.

## Language / locale

Search is stored per locale. The portable analyzer applies Unicode
normalization, ICU word segmentation, identifier preservation, optional
language expanders, and Han bigrams before the adapter writes parser-safe
physical terms to PostgreSQL. `defaultLocale` supplies the analyzer fallback
when content or a query does not declare a usable locale:

```ts
postgresSearch({ pool: db.pool, defaultLocale: 'en' })
```

For language-specific stemming or lemmatization, construct a portable analyzer
with versioned expanders and pass it as `analyzer`. The provider persists its
fingerprint per collection. If that fingerprint changes, clear and rebuild the
affected collection before it accepts new writes or searches; this prevents
mixed token pipelines from producing incomplete results.
