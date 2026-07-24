---
'@byline/core': minor
'@byline/db-postgres': patch
---

Moved the dialect-independent storage machinery — `flattenFieldSetData`, `restoreFieldSetData`, `resolveStoreTypes`, the `UnifiedFieldValue` / `FlattenedFieldValue` row types, and the store-column manifest data (`storeColumnManifest`, `storeTableNames`) — from `@byline/db-postgres` into `@byline/core`, so a future `IDbAdapter` implementation can consume the same flatten/reconstruct pipeline and column manifest without depending on the Postgres adapter. `@byline/db-postgres` keeps its own SQL generation (`storeSelectList`, `pgNullCast`) and adds a `normalizeRow` seam at the UNION-row ingestion site.

Extracted the Postgres integration test suite that exercises this machinery into a new private, adapter-agnostic conformance suite (`@byline/db-conformance`, not published) that any `IDbAdapter` can run against its own test database. `@byline/db-postgres` now runs that suite via `tests/conformance.integration.test.ts`; no test coverage was dropped or weakened.

Fixed a race in `ensureCounterGroup`: concurrent processes creating the same brand-new counter sequence could hit Postgres's `CREATE SEQUENCE IF NOT EXISTS` raising a duplicate-object error (SQLSTATE 23505); the adapter now absorbs that specific error instead of surfacing it as a failure.
