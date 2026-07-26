---
title: "PostgreSQL and MySQL search providers"
path: "postgres-mysql-search"
summary: "How the built-in SQL providers store, rank, highlight, migrate, and validate the same portable search contract while reusing the application's database."
---

# PostgreSQL and MySQL search providers

Companions:
- [Configure search](./01-configuration.md) — registration and collection configuration are shared across both providers.
- [Indexing and reindexing](./02-indexing-and-reindexing.md) — both providers consume the same published-document lifecycle.
- [Provider contract](./04-provider-contract.md) — the shared interface and capability requirements.
- [Portable multilingual analysis](./05-portable-analysis.md) — both providers index the same logical terms and analyzer fingerprint.

`@byline/search-postgres` and `@byline/search-mysql` provide the same application-facing search behavior over different database full-text primitives. Both reuse the host database pool and keep their derived index in the same database as the application.

## Shared behavior

Both providers:

- store one row per `(collectionPath, documentId, locale)`;
- accept the same `SearchDocument`;
- use `@byline/search-analysis`;
- support all, any, minimum-should-match, and phrase matching;
- preserve identifiers and Han-gram fallback;
- map field boosts into A through D weight classes;
- rank with deterministic tie-breaking;
- return portable highlighted body snippets;
- scope by collection or zone, locale, and status;
- store facets and filters for future queries;
- store one analyzer fingerprint metadata row per collection;
- reject incompatible fingerprints; and
- own an independent migration stream.

Their capability reports are currently equivalent:

```ts
{
  facets: false,
  typoTolerance: false,
  semantic: false,
  bm25: false,
  weighting: true,
  highlights: true,
  fullText: {
    nativeAnalysis: false,
    portableAnalysis: true,
    allTerms: true,
    anyTerms: true,
    minimumShouldMatch: true,
    phrase: true,
  },
}
```

## Implementation comparison

| Concern | PostgreSQL | MySQL |
|---|---|---|
| Package | `@byline/search-postgres` | `@byline/search-mysql` |
| Driver peer | `pg` | `mysql2` |
| Full-text storage | one weighted `tsvector` | one matching stream plus four weighted `FULLTEXT` streams |
| Full-text index | GIN on `search_vector` | five InnoDB `FULLTEXT` indexes |
| Zone storage | `text[]` with GIN | JSON |
| Facet and filter storage | `jsonb` | JSON |
| Ranking | `ts_rank` | weighted sum of `MATCH ... AGAINST` |
| Weight realization | `tsvector` A through D positions | score multipliers 8, 4, 2, 1 |
| Migration behavior | transactional per file | DDL auto-commit with advisory lock |
| Whole-index clear | `TRUNCATE` | `DELETE` |

## PostgreSQL provider

Register the provider with the pool returned by `pgAdapter`:

```ts
import { migrate, postgresSearch } from '@byline/search-postgres'

await migrate(db.pool)

const search = postgresSearch({
  pool: db.pool,
  defaultLocale: 'en',
})
```

The `byline_search_documents` table stores:

- original body text for highlights;
- a weighted portable `tsvector`;
- collection, document, locale, status, and zone scope;
- title, path, and update time;
- analyzer fingerprint; and
- `jsonb` facet and filter projections.

Portable terms are encoded before being rendered into the `tsvector`. Exact and identifier tokens keep their source field's weight. Derived tokens lose one weight class. Han grams use class D.

The provider translates portable concepts into `to_tsquery('simple', ...)` expressions. `ts_rank` produces the score. Results order by score descending, update time descending, then collection path, document id, and locale so offset pagination is deterministic on ties.

PostgreSQL `ts_rank` is not exposed as a BM25 guarantee, so `capabilities.bm25` remains false.

## MySQL provider

Register the provider with the promise pool returned by `mysqlAdapter`:

```ts
import { migrate, mysqlSearch } from '@byline/search-mysql'

await migrate(db.pool)

const search = mysqlSearch({
  pool: db.pool,
  defaultLocale: 'en',
})
```

MySQL's full-text parser has server-dependent stopword and minimum-token behavior. The provider avoids making those settings part of Byline's contract by encoding every logical token into parser-safe ASCII before MySQL sees it.

The physical row contains:

- `search_text` for matching semantics;
- `search_a` through `search_d` for weighted scoring;
- original body text for highlights;
- scope and display metadata;
- analyzer fingerprint; and
- JSON facet and filter projections.

The provider keeps separate source, expansion-kind, and Han-gram streams so phrase matching follows the analyzer's logical positions. Query phrase variants mirror those physical stream kinds. It does not generate impossible mixed-kind Cartesian products.

The score is:

```text
8 * MATCH(search_a)
+ 4 * MATCH(search_b)
+ 2 * MATCH(search_c)
+ 1 * MATCH(search_d)
```

MySQL's native relevance value may include term-frequency and inverse-document-frequency behavior, but the provider does not claim a stable BM25 contract.

## Schema ownership

Each provider ships:

- `migrations/0001_init.sql` as the readable source of truth;
- embedded migration data for bundled server runtimes;
- `migrate(pool)` for explicit application; and
- `autoMigrate` as a development convenience.

The migration ledger is `byline_search_migrations`. Analyzer metadata lives in `byline_search_index_metadata`. Indexed documents live in `byline_search_documents`.

These names are provider-owned and independent of the storage adapter's Drizzle migrations. The search index can be dropped without deleting CMS documents.

### PostgreSQL migration guarantees

The PostgreSQL migrator creates the ledger, reads applied versions, and runs each pending file inside a transaction. It records the version only after the SQL succeeds.

### MySQL migration guarantees

MySQL DDL auto-commits, so its migrator cannot provide the same per-file transaction. It:

1. acquires the `byline-search-mysql-migrations` server lock;
2. applies idempotent semicolon-delimited statements;
3. records the version only after all statements succeed; and
4. releases the lock before returning.

Migration files must not contain stored routines that require internal delimiter changes.

## Analyzer metadata

An upsert first establishes or reads the collection metadata row under a lock. A provider instance with another fingerprint rejects the write rather than mixing incompatible tokens.

Before a query, the provider checks metadata scoped to the requested collection or zone. The check reads the compact collection metadata table and does not scan the document projection.

After changing analyzer behavior:

```ts
await client.collection('docs').reindex()
```

The client method calls the provider clear operation first, then repopulates published content.

## Choosing a provider

Use the provider that matches the application's storage database. Search does not require choosing or operating a second engine.

PostgreSQL is Byline's supported default and the adapter scaffolded by the CLI. MySQL search passes the same provider conformance suite, but the wider MySQL backend remains preliminary. If you need a fully supported default installation, choose PostgreSQL. If you already operate a controlled MySQL installation, the search provider offers the same portable matching floor.

A dedicated engine becomes useful when the product requires capabilities the SQL providers do not claim, such as mature typo tolerance, spelling suggestions, complex facet aggregation, semantic retrieval, or engine-specific ranking. That engine should still implement `SearchProvider` so authorization and hydration remain in the Byline pipeline.
