# @byline/search-postgres

The built-in Postgres full-text `SearchProvider` for Byline CMS. Implements the
`SearchProvider` seam from `@byline/core` over a weighted `tsvector` index —
ranked search with **zero new infrastructure**, reusing your existing Postgres
connection.

It consumes the type-enriched `SearchDocument` that core assembles
(`buildSearchDocument`) and stores one weighted row per
`(collection_path, document_id, locale)`: `title` → weight class `A`, `body`
fields → `A`–`D` by their declared `boost`, facet **terms** → `C` (folded into
the searchable vector), with facet **ids** and filterable scalars kept as
`jsonb` for aggregation / filtering.

See [`docs/05-reading-and-delivery/07-search.md`](../../docs/05-reading-and-delivery/07-search.md)
for the full subsystem design.

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
//   bm25: false, weighting: true, highlights: true }
```

The `tsvector` + `ts_rank` floor: per-field **weighting** and **highlighting**
(`ts_headline`) are supported today. Facet *data* is indexed, but facet
*aggregation* queries, structured `where` filtering, fuzzy matching (`pg_trgm`),
BM25 ranking, and semantic/vector retrieval are follow-ups — surfaced honestly
through the capability flags so consumers light up only what's available.

## Language / locale

Search is per-locale. Each document's text is indexed with the Postgres
`regconfig` mapped from its content locale (`en` → `english`, `fr` → `french`,
…), falling back to `simple` (unstemmed) for unmapped locales. Pass `locale`
to `search()` so the query uses the matching `regconfig` (a locale-less query
falls back to `simple` and won't match locale-stemmed vectors) — or set
`defaultLocale` so locale-less queries use your default content locale:

```ts
postgresSearch({
  pool: db.pool,
  defaultLocale: 'en',             // regconfig for searches that omit `locale`
  localeRegconfig: { th: 'thai' }, // a custom dictionary you've installed
  fallbackRegconfig: 'simple',
})
```
