# @byline/db-mysql

## 5.1.4

### Patch Changes

- **`@byline/admin`** capped analytics dashboard cards at ten rows with a paged view-all dialog and localised country names
- Updated dependencies
  - @byline/admin@5.1.4
  - @byline/core@5.1.4

## 5.1.3

### Patch Changes

- **`@byline/host-tanstack-start`** renewed expired admin sessions in place on admin navigation and recovered the public admin bar and preview mode after access expiry
  replaced the sign-in session check text with a spinner and styled its error states
- Updated dependencies
  - @byline/admin@5.1.3
  - @byline/core@5.1.3

## 5.1.2

### Patch Changes

- Fixed **`@byline/db-postgres`**, **`@byline/analytics-postgres`** and **`@byline/search-postgres`** publishing `pg` types in their public declarations while `@types/pg` was only a devDependency, which left consumers with an untyped `pool` and implicit-any errors in their own code.
- Updated dependencies
  - @byline/admin@5.1.2
  - @byline/core@5.1.2

## 5.1.1

### Patch Changes

- Styled and translated the account-mismatch session interstitial in **`@byline/host-tanstack-start`** — it now renders a centred card using the admin's own typography and colour tokens, with UI Kit buttons, across all eight admin locales.
- Updated dependencies
  - @byline/admin@5.1.1
  - @byline/core@5.1.1

## 5.1.0

### Minor Changes

- 4d02070: Require pre-verification protection for TanStack password sign-in. Existing installations must configure it before deploying this release; missing protection fails closed with HTTP 503. Custom admin stores must implement `signInRateLimits` and custom limiters must implement capacity acquisition as well as counter admission.
  
  Upgrade in this order:
  
  1. Apply `packages/db-postgres/sql/0011_add-sign-in-rate-limits.sql` or `packages/db-mysql/sql/0006_add-sign-in-rate-limits.sql` to the production database. The Postgres script includes the deployment ownership guard.
  2. Register `passwordSignInMiddleware` after CSRF middleware in `src/start.ts`. Configure `ServerConfig.passwordSignIn` with a process-singleton `createPasswordSignInLimiter(adminStore.signInRateLimits, signingSecret)` and an explicitly trusted client-IP resolver. Proxy header mode accepts a single overwritten address, never an address list or fallback chain.
  3. Register the returned limiter's `cleanupTask` in `recurringTasks` and start `startBylineScheduler(core)` from the host server entry, or arrange external `runDueTasks(core)` execution. Boot rejects missing required cleanup-task registration; it cannot prove that the runner is executing. Verify task health after deployment. Config imports remain inert.
  4. Wire limiter `onEvent` monitoring, verify proxy resolution, keep the HMAC secret consistent across instances, and deploy the application. See the password sign-in protection section in `docs/07-auth-and-security/01-authn-authz.md` for capacity defaults and distributed-guessing tradeoffs.
  
  The release maintainer must squash development Drizzle migrations, repair development journals, synchronize CLI migration baselines, and rerun baseline checks before publishing. Incremental Drizzle scripts are not production SQL release scripts.
  
  Counter and event identifiers now use domain-separated HMAC-SHA-256. Reusing the JWT installation secret is supported. Changing the secret resets live budgets and event correlation; existing rows expire normally. The per-process capacity ceiling is approximately 600 operations/minute (2,400 across four processes), subject to hashing and database latency.
  
  Native session revocation adds account and refresh `session_version` columns and the access JWT `sv` claim. Stop every old instance, apply PostgreSQL `0012_add-session-generations.sql` or MySQL `0007_add-session-generations.sql`, then restart all instances together. Existing access and refresh credentials require fresh sign-in. Password changes/resets and disablement atomically invalidate native sessions; re-enable never revives them. Custom admin stores must implement the transactional `withSessionLock` contract and mutation revocation, and custom identity providers remain responsible for their own sessions. The coordinated renewal and login-identity boundary below complete the implementation scope; combined R2/R3 review is approved.
  
  **Approved residual:** strict replay still revokes the winning successor if a refresh contest escapes coordination. The host now coordinates ordinary parallel requests, and the user accepted fresh sign-in for residual contests. Combined R2/R3 review is approved; ship the generation and login protocol changes together. Refresh issuance requires explicit `session_version` input; missing or malformed input throws at runtime.
  
  JWT sessions now carry a stable native login identity (`sid`). Access verification checks account generation and login validity; logout and replay revoke that login immediately without traversing refresh chains. Ordinary requests no longer rotate credentials. The host uses explicit coordinated renewal, checks expected login identity before business handlers, and requires acknowledgement when the active login changes. Logout failures are reported rather than silently treated as success.
  
  Combined-release cutover: apply both generation and login-state migrations during one stopped-instance upgrade and require fresh sign-in once. Legacy credentials missing `sv` or `sid` fail closed; there are not two user-facing upgrades. Sliding refresh expiry and persistent sign-in survive normal browser restarts. No absolute monthly lifetime is introduced.
  
  Custom session providers must return a stable `sessionId` from issuance and verification, accept observed access/refresh credentials through `RevokeSessionArgs`, honor expected identity during renewal/logout, and distinguish access expiry from other errors. Hosts must register `sessionRequestMiddleware` after CSRF protection. Native login persistence stays behind the provider interface. Combined R2/R3 review is approved. Release still requires migration-baseline synchronization, final build/gates, downstream review, and the coordinated cutover.

### Patch Changes

- Updated dependencies [4d02070]
  - @byline/admin@5.1.0
  - @byline/core@5.1.0

## 5.0.0

### Major Changes

- f8ece18: Require document-wide optimistic-concurrency observations for every existing-document mutation. Editable SDK reads now return a document revision, successful mutations return the next revision, and stale or missing observations fail closed across core, both database providers, the SDK, and the TanStack host.
  
  The admin editor retains unsaved work after a conflict, blocks further mutations, and requires an explicit reload-and-discard action. Metadata and structural changes participate in the same revision contract, and affected scheduled publications require reconfirmation.
  
  Existing PostgreSQL and MySQL installations must use the provider-specific fenced cutover runbooks and numbered native SQL upgrades before starting the new packages. Rolling mixed-version writers and rollback to an old writer after reopening writes are unsupported. The CLI includes synchronized fresh-install baselines for new databases; package installation does not update copied maintenance scripts in an existing application.

### Patch Changes

- Updated dependencies [f8ece18]
  - @byline/admin@5.0.0
  - @byline/core@5.0.0

## 4.19.0

### Minor Changes

- ff1c416: Reject stale `previousVersionId` values with `ERR_CONFLICT`, and require the current parent for locale-scoped writes to existing versioned documents instead of silently carrying other locales forward from the wrong version.

### Patch Changes

- Updated dependencies [ff1c416]
- Updated dependencies [ff1c416]
- Updated dependencies [77e5ace]
  - @byline/core@4.19.0
  - @byline/admin@4.19.0

## 4.18.0

### Minor Changes

- Added provider-neutral field-scoped full-text search queries with client pass-through
  
  Fixed the admin list pager so page changes scroll back to the top

### Patch Changes

- Updated dependencies
  - @byline/admin@4.18.0
  - @byline/core@4.18.0

## 4.17.0

### Minor Changes

- added singleton document resources — a single named document slot with its own schema, lifecycle, typed client handle, and admin editor
  fixed dirty-state loss on failed form saves and corrected restore confirmation copy for single-status workflows

### Patch Changes

- Updated dependencies
  - @byline/admin@4.17.0
  - @byline/core@4.17.0

## 4.16.0

### Minor Changes

- Analytics

### Patch Changes

- Updated dependencies
- Updated dependencies [4b94573]
  - @byline/admin@4.16.0
  - @byline/core@4.16.0

## 4.15.0

### Minor Changes

- added scheduled publication — arm, suspend on edit, re-confirm, and an operational admin queue — driven by a new in-process recurring-task scheduler
  added the MySQL scheduler adapter so both canonical adapters pass the shared conformance suite unchanged

### Patch Changes

- Updated dependencies
  - @byline/admin@4.15.0
  - @byline/core@4.15.0

## 4.14.1

### Patch Changes

- fixed the admin dashboard showing a zero total for collections with stats turned off, and pinned the admin menu drawer so it stays in view while the admin area scrolls
- Updated dependencies
  - @byline/admin@4.14.1
  - @byline/core@4.14.1

## 4.14.0

### Minor Changes

- added admin dashboard collection groups — an ordered `AdminConfig.collectionGroups` registry that collections join by key via `CollectionAdminConfig.group`, boot-validated and additive (omit it and the dashboard is unchanged)
  fixed the dashboard showing collections the administrator cannot read, which previously rendered every status tile as zero and was indistinguishable from an empty collection

### Patch Changes

- Updated dependencies
  - @byline/admin@4.14.0
  - @byline/core@4.14.0

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
