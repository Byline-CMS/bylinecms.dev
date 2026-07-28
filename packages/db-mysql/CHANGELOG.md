# @byline/db-mysql

## 4.10.2

### Patch Changes

- fixed a fresh install failing to hydrate: use-sync-external-store is now installed as a host dependency, and `@byline/i18n/react` is pre-bundled so one <I18nProvider> instance serves the whole admin
  fixed `byline init` reporting an already-merged `vite.config.ts` as complete instead of bringing Byline-owned settings up to date
- Updated dependencies
  - @byline/admin@4.10.2
  - @byline/core@4.10.2

## 4.10.1

### Patch Changes

- fixed `byline init` leaving a fresh TanStack Start app unable to boot, by merging Byline's required Vite settings into an existing `vite.config.ts`
  fixed scaffolded seed and import scripts hanging instead of exiting once their work committed
- Updated dependencies
  - @byline/admin@4.10.1
  - @byline/core@4.10.1

## 4.10.0

### Minor Changes

- added MySQL as a first-class `byline init` / `byline setup` database choice, with per-adapter squashed baselines refused on any occupied database
  pinned `@byline/db-*` exactly to the CLI release carrying its baseline

### Patch Changes

- Updated dependencies
  - @byline/admin@4.10.0
  - @byline/core@4.10.0

## 4.9.0

### Minor Changes

- added portable multilingual search analysis with built-in PostgreSQL and MySQL full-text providers, shared provider conformance, and original-text highlighted snippets
  hardened query analysis against quadratic identifier scanning and preserved SKU/version constituent recall
- 78726f3: Added the built-in MySQL full-text `SearchProvider`, backed by portable
  multilingual analysis, weighted MySQL `FULLTEXT` indexes, driver-owned
  migrations, analyzer-fingerprint enforcement, and the shared provider
  conformance suite. Ranked hits include portable highlighted snippets from the
  stored original body text.

  Documented and wired `@byline/db-mysql` installations to use the real search
  provider instead of a no-op workaround. Fingerprint checks use collection
  metadata rather than scanning indexed documents, and phrase translation now
  emits only the source and expansion-kind variants represented by physical
  matching streams.

### Patch Changes

- Updated dependencies
- Updated dependencies [635c16a]
- Updated dependencies [78726f3]
  - @byline/admin@4.9.0
  - @byline/core@4.9.0

## 4.8.0

### Minor Changes

- 06ac2db: Added `@byline/db-mysql`, Byline's second database adapter — **published as preliminary,
  not as fully supported MySQL support.** The storage layer is complete and proven: it
  passes the entire shared `@byline/db-conformance` behavioural suite, the same suite
  `@byline/db-postgres` passes, with identical results. What is missing is the surrounding
  ecosystem, and one gap needs stating plainly because it fails at boot rather than
  degrading quietly: **there is no MySQL search provider**, and `initBylineCore()` throws
  when a collection declares a `search` block with no provider registered. Byline's own
  reference application opts five collections into search, so a MySQL installation copying
  it will not start until a no-op provider is registered — `packages/db-mysql/README.md`
  gives the snippet. `byline init` also does not yet scaffold MySQL, and CI pins the 8.0
  engine floor so nothing exercises 9.x automatically. Treat this release as suitable for
  evaluation, prototypes, and installations that do not need search.

  `mysqlAdapter()` implements
  the same `IDbAdapter` contract as `@byline/db-postgres` over MySQL 8.0.14+ (InnoDB only;
  the boot check rejects older servers and MariaDB) and passes the same shared
  `@byline/db-conformance` suite the Postgres adapter runs, so document storage, versioning,
  patches, workflow, populate, and admin auth behave identically regardless of which
  database is configured. See `packages/db-mysql/README.md` for install steps, the engine
  floor, and the documented differences from the Postgres adapter.

  **BREAKING (`@byline/db-postgres`):** `date` and `datetime` field values now arrive as
  `Date` objects instead of raw driver strings. `date` values are anchored to **UTC
  midnight** for their calendar day; `datetime` values carry the full instant; `time`
  values are unchanged and remain a string. This was previously undocumented raw driver
  output — `packages/core/src/storage/storage-row-types.ts` already typed both columns as
  `Date | string`, so code written to handle either shape is unaffected. Check any code
  that reads a `date` or `datetime` field value and calls a string method on it (`.slice()`,
  `.split()`, a regex) or hands it to a date-parsing library expecting a string — that code
  now receives a `Date` and must be updated to use `Date` methods (or call `.toISOString()`
  itself) instead. This is a `minor`, not a `major`, release: every publishable `@byline/*`
  package is versioned in one lockstep group, and this change does not warrant taking all
  sixteen packages to 5.0.0.

### Patch Changes

- Updated dependencies [7211479]
  - @byline/core@4.8.0
  - @byline/admin@4.8.0
