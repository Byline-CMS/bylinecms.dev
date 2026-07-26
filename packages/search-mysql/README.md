# @byline/search-mysql

The built-in MySQL full-text `SearchProvider` for Byline CMS. It combines the
portable multilingual analyzer from `@byline/search-analysis` with weighted
MySQL `FULLTEXT` indexes, providing ranked search with no additional service
and reusing the existing MySQL connection pool.

It stores one row per `(collection_path, document_id, locale)`. Searchable
logical terms are encoded into parser-safe ASCII tokens before MySQL sees them,
which preserves Byline's normalization, identifier, expansion, and Han-gram
semantics without depending on server stopword lists or minimum token lengths.
Four physical indexes retain the A–D field-weight classes used by the built-in
PostgreSQL provider.

See
[`docs/05-reading-and-delivery/07-search.md`](../../docs/05-reading-and-delivery/07-search.md)
for the full subsystem design.

## Install

```sh
pnpm add @byline/search-mysql
```

`mysql2` is a peer dependency. An installation using `@byline/db-mysql`
already has it.

## Register

The provider reuses the host's existing promise pool (`db.pool` from
`mysqlAdapter`), so the index lives in the same database:

```ts
import { defineServerConfig } from '@byline/core'
import { mysqlAdapter } from '@byline/db-mysql'
import { mysqlSearch } from '@byline/search-mysql'

const db = mysqlAdapter({ connectionString, collections, defaultContentLocale })

defineServerConfig({
  db,
  search: mysqlSearch({ pool: db.pool }),
  // …
})
```

A collection opts into indexing through its `search` config
(`{ body, facets, filters, zones }`). `initBylineCore()` fails fast if a
collection opts in but no provider is registered.

## Schema and migrations

This driver owns a disposable search projection. Its numbered SQL files under
[`migrations/`](./migrations) are independent of the host database adapter's
Drizzle migrations and are tracked in `byline_search_migrations`.

For production, apply pending migrations deliberately before serving traffic:

```ts
import { migrate } from '@byline/search-mysql'

const { applied } = await migrate(db.pool, { log: (message) => logger.info(message) })
```

MySQL auto-commits DDL. The migrator therefore uses a server advisory lock,
idempotent DDL, and records a version only after every statement succeeds.
Migration files must contain ordinary semicolon-delimited statements, not
stored routines with internal delimiters.

For local development, `mysqlSearch({ pool: db.pool, autoMigrate: true })`
starts migration in the background. Prefer an explicit awaited `migrate()`
call whenever deterministic startup matters.

There is no compatibility migration for earlier experimental schemas. Drop
only the search-owned tables, apply `0001_init.sql`, and rebuild searchable
collections from their published versions:

```sql
DROP TABLE IF EXISTS byline_search_index_metadata;
DROP TABLE IF EXISTS byline_search_documents;
DROP TABLE IF EXISTS byline_search_migrations;
```

## Capabilities

The adapter supports portable analysis, `all` and `any` matching,
minimum-should-match, phrase constraints, field weighting, and highlighted
snippets built from stored original body text with the shared portable token
offsets. Facet data and typed filters are retained in JSON for future query
features.

Facet aggregation, structured filtering, typo tolerance, semantic retrieval,
and BM25 are currently reported as unsupported. MySQL's native relevance score
contributes term frequency and inverse document frequency, but the provider
does not claim BM25 because MySQL does not expose a stable BM25 contract.

## Language and locale

The portable analyzer applies Unicode normalization, ICU word segmentation,
identifier preservation, optional language expanders, and Han bigrams before
the adapter writes physical terms. `defaultLocale` supplies the fallback when
content or a query does not declare a usable locale:

```ts
mysqlSearch({ pool: db.pool, defaultLocale: 'en' })
```

Custom analyzers must have stable, versioned fingerprints. The provider stores
the fingerprint per collection and rejects mixed analysis pipelines. Clear and
reindex an affected collection after changing its analyzer.
