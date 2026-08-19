# @byline/db-mysql

## 4.13.1

### Patch Changes

- fixed **`@byline/richtext-lexical`** inline-image previews serving a stale URL in the editor after an upload was re-keyed or regenerated
- Updated dependencies
  - @byline/admin@4.13.1
  - @byline/core@4.13.1

## 4.13.0

### Minor Changes

- added a bundled Thai (`th`) admin interface locale to **`@byline/i18n`**
  fixed the admin route progress bar against TanStack Router's removal of `isTransitioning`

### Patch Changes

- Updated dependencies
  - @byline/admin@4.13.0
  - @byline/core@4.13.0

## 4.12.0

### Patch Changes

- Updated dependencies [ae500fb]
- Updated dependencies [1a1c2d0]
- Updated dependencies [7df2278]
- Updated dependencies [c6ee4b5]
  - @byline/admin@4.12.0
  - @byline/core@4.12.0

## 4.11.2

### Patch Changes

- fixed **`@byline/richtext-lexical`** and **`@byline/ai`** command payload types for lexical 0.49, including an inline-image enter handler that could throw on IME input

  **`@byline/cli`** wire prompt now names the vite.config.ts backup file

- Updated dependencies
  - @byline/admin@4.11.2
  - @byline/core@4.11.2

## 4.11.1

### Patch Changes

- replaced classnames with clsx across all packages, fixing a cold-start vite optimizer error that broke admin modules in cli-installed apps
- Updated dependencies
  - @byline/admin@4.11.1
  - @byline/core@4.11.1

## 4.11.0

### Minor Changes

- released document paths on soft delete so a new document can claim a deleted document's path, enforced live-only in **`@byline/db-postgres`** and **`@byline/db-mysql`**
  soft delete now retains uploaded sources and generated variants; existing installations must apply the numbered native `sql/` upgrade script for their provider
- 540b06f: Released document paths when a document is soft-deleted while retaining the
  path value for history and explicit restoration. PostgreSQL and MySQL now
  enforce path uniqueness only among live documents, filter path lookup to live
  rows, and restore every version and retained path atomically. Existing
  installations must apply
  `packages/db-postgres/sql/0006_soft_delete_path_liveness.sql` or
  `packages/db-mysql/sql/0001_soft_delete_path_liveness.sql`; the squashed
  Drizzle and CLI baselines are for fresh installations, not upgrades.

  Lifecycle `ERR_PATH_CONFLICT` messages now identify the attempted operation and
  state that a live document owns the requested path. Update operations report
  the document's source locale rather than the configured default locale. The
  error code and public details shape are unchanged.

  Soft delete now retains field rows, uploaded sources, and persisted generated
  variants. Source and variant paths are immutable historical references that can
  be shared by versions or duplicated documents, so deletion no longer infers
  ownership or removes objects from storage. `storageCleanup` was removed from
  the public delete side-effect phase union; only `afterTreeChange` and
  `afterDelete` remain. No supported purge or reference-safe reclamation
  operation exists yet. [Issue
  #72](https://github.com/Byline-CMS/bylinecms.dev/issues/72) tracks generation
  recipes, provider-neutral source reads, shared-reference analysis,
  regeneration, and eventual cleanup.

  `IDocumentCommands` now requires
  `restoreSoftDeletedDocument({ document_id })`. Both built-in adapters implement
  it. Out-of-tree `IDbAdapter` implementations must add the command and atomically
  reactivate every version and path row, allowing live-path conflicts to roll the
  operation back. The storage primitive does not reconstruct tree placement or
  search/cache projections.

  Existing-document version writes now take a row-scoped document lock before
  checking liveness. Concurrent saves to the same document serialize with each
  other and with soft-delete/un-delete, while writes to unrelated documents
  remain concurrent. A fully deleted document cannot gain a live version except
  through whole-document un-delete.

### Patch Changes

- Updated dependencies
- Updated dependencies [540b06f]
  - @byline/admin@4.11.0
  - @byline/core@4.11.0

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
