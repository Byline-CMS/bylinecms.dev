# Soft-delete path release, restoration, and media retention — implementation plan

**Status:** Draft for review, revised after repository feedback

**Date:** 2026-07-30

**Issue:** [#69 — Soft-deleted documents hold their path against new documents](https://github.com/Byline-CMS/bylinecms.dev/issues/69)

**Primary outcome:** Soft deletion releases a document's public path without losing that path or
destroying restorable content. PostgreSQL and MySQL gain the same storage-level un-delete
primitive. Original uploaded files and generated variants remain retained. Variant reclamation and
regeneration are deferred to a separate follow-on investigation.

## Goal

Complete the persistence side of Byline's soft-delete model:

- a soft-deleted document no longer blocks a new document from using its old path;
- the deleted document retains its original path for administration and restoration;
- path liveness cannot be independently hand-written away from the path deletion timestamp;
- soft delete and storage-level un-delete keep version tombstones and path liveness synchronized
  in one transaction;
- normal path reads resolve only live path rows;
- original uploaded files are never removed by soft delete;
- PostgreSQL and MySQL expose and test identical behavior;
- the deleted-document `--force` import workaround is removed rather than reworked, and no importer
  mutates `is_deleted` through raw SQL;
- the reference document importer stops depending on PostgreSQL adapter internals;
- path conflicts use operation-appropriate explanations;
- the administrator trash/list/restore interface remains a separate phase.

Generated media variants may eventually be treated as reclaimable derivatives rather than source
assets. That decision depends on a broader storage-path model—including whether variant locations
remain persisted identities or become rule-derived dynamic paths—and is explicitly outside this
plan.

## Non-goals

- An administrator interface for listing, inspecting, or restoring deleted documents.
- Hard delete or purge.
- A retention scheduler or background purge worker.
- Restoring historical tree placement. A restored tree document returns unplaced; deleted children
  that were promoted remain where deletion placed them.
- Per-locale path editing.
- Automatically choosing a replacement path when an original path has been reclaimed.
- Treating a deleted path row as a path conflict. Deleted rows are historical records and do not
  own the live namespace.
- Changing `deleteDocumentLocale` path ownership. Deleting one content locale continues to leave
  its path row active; this is pre-existing behavior and should be tracked separately before
  per-locale path editing ships.
- Deleting original uploaded files during soft delete.
- Deleting or regenerating generated variants during soft delete or un-delete.
- Choosing between persisted variant paths and rules-based dynamic variant paths.

## Acceptance criteria

### Required

1. Deleting document A at path `example`, then creating document B at `example`, succeeds through
   the normal lifecycle API.
2. Document A retains `path = 'example'` and a deletion timestamp after deletion.
3. A live document still cannot claim a path held by another live document.
4. Any number of deleted documents may retain the same `(collection, locale, path)`.
5. `findByPath('example')` resolves the live occupant deterministically when deleted rows also
   retain `example`. Determinism comes from `alive = true` plus the unique constraint permitting
   at most one live row per `(collection_id, locale, path)`; locale priority remains the only
   required ordering.
6. Soft delete updates every version tombstone and every path-row deletion timestamp atomically.
7. Storage-level un-delete clears every version tombstone and every path-row deletion timestamp
   atomically while preserving path values and workflow statuses.
8. Un-delete fails atomically when the original path has been claimed: no version becomes live and
   no path row becomes active.
9. Missing and already-live document IDs produce a documented idempotent result from the
   storage-level un-delete command.
10. Soft delete never calls `storage.delete()` for an original uploaded file.
11. In the required phase, soft delete also retains every generated variant.
12. PostgreSQL and MySQL pass the same shared conformance cases.
13. Existing fully deleted documents are migrated to inactive path rows. Documents with any
   non-deleted version remain active.
14. The document importer's ordinary path-based upsert updates a live occupant and creates a new
    document when no live occupant exists, even when deleted tombstones retain the path.
15. The deleted-document `--force` workaround and `import-docs-force.ts` are removed; no importer
    updates `is_deleted` through raw SQL.
16. A delete followed by a plain re-import produces a new document ID, and `findByPath` resolves
    that new live document.
17. `--tree` continues rebuilding placement from the imported directory structure for the newly
    created document ID.
18. `regenerate-media.ts` and `regenerate-media-operation.ts` retain their existing behavior.
19. The document importer no longer depends on PostgreSQL adapter internals. The raw pool, the
    `PgAdapter` cast, and the pool plumbing through media ingest are gone, and the importer's
    remaining database access runs through adapter-neutral client APIs.
20. `restoreSoftDeletedDocument` is a required member of `IDocumentCommands`, implemented by both
    built-in adapters, with the contract addition called out for out-of-tree adapter authors.
21. Documentation distinguishes:
    - restoring a historical version of a live document;
    - un-deleting a soft-deleted logical document;
    - future hard delete/purge.
22. Duplicating to a path retained only by a deleted document succeeds without the short-UUID
    conflict suffix; a live conflict continues to take the existing suffix/retry path.
23. A changeset and release notes state that soft deletion no longer reclaims source or variant
    storage and that no supported purge operation exists yet.

## Durable model

### Path rows retain history and release ownership

`byline_document_paths` gains two columns:

```text
deleted_at  timestamp nullable
alive       boolean generated always as (
              case when deleted_at is null then true else null end
            ) stored
```

The live-namespace constraint becomes:

```text
UNIQUE (collection_id, locale, path, alive)
```

The constraint keeps its existing name:

```text
idx_document_paths_collection_locale_path
```

That name is load-bearing in PostgreSQL/MySQL error classification and core's
`ERR_PATH_CONFLICT` mapping.

Both supported databases permit repeated unique-key tuples when one indexed value is `NULL`.
Consequently:

- live rows carry `alive = true` and remain unique;
- deleted rows derive `alive = NULL` and do not collide;
- `alive` cannot be set independently from `deleted_at`;
- the original path remains available to a future deleted-document administration surface.

The existing `unique_document_paths_document_locale` constraint remains unchanged on
`(document_id, locale)`. Soft delete changes liveness on the document's existing path rows rather
than inserting historical path-row copies, so the one-row-per-document-locale invariant still
holds independently from live namespace ownership.

Do not put `deleted_at` itself in the unique constraint. A bulk operation can assign the same
transaction timestamp to several rows, causing deleted rows with the same path to collide.

The repository currently pins `drizzle-orm` 0.45.2 and `drizzle-kit` 0.31.10. Their PostgreSQL and
MySQL column builders both support `generatedAlwaysAs()`. A local schema probe represents the
proposed expression as `mode: 'stored'` for both dialects. Generated SQL must still be inspected
and exercised against both real databases before this design is considered verified. Task 0 is a
blocking preflight: do not write the behavioral test suite against this schema until that gate
passes or the fallback schema is adopted.

### The denormalization boundary

The generated column prevents `alive` from drifting from `deleted_at`; it does not magically keep
path-row `deleted_at` synchronized with version-row `is_deleted`. The supported commands and their
transaction boundaries own that invariant:

```text
soft delete:
  path.deleted_at = one operation timestamp
  every version.is_deleted = true

storage un-delete:
  path.deleted_at = null
  every version.is_deleted = false
```

No production or repository-import path may update only one side. Removing the existing raw-SQL
revival code is part of the schema change, not follow-up cleanup.

### Storage-level un-delete

Add `restoreSoftDeletedDocument` to `IDocumentCommands`. This name deliberately distinguishes
whole-document un-delete from `restoreDocumentVersion`, which promotes historical content on an
already-live document.

The command is the faithful storage inverse of soft delete:

- it takes the same collection/document locks in the same order as soft delete;
- it operates in one transaction;
- it reactivates all path rows for the document;
- it clears `is_deleted` on every version;
- it preserves workflow statuses and path values;
- it returns the number of restored versions;
- it returns `0` for a missing or already-live document;
- a live path collision remains a classified unique violation and rolls back the entire command.

This phase exposes the adapter/core storage contract but does not add an administrator route or
client method. Before a general lifecycle/UI restore operation is exposed, the project must decide
whether that higher-level operation faithfully restores published status or deliberately returns
the document as a draft. The low-level storage primitive must not silently encode that editorial
policy. It also does not reconstruct tree placement or restore search/cache projections removed
during deletion.

### Path conflict language

The active-marker design means a deleted document does not hold a path. Error language should
reflect the attempted operation:

- create/update: `Path is already used by another live document.`
- un-delete: `The document cannot be restored at its original path because that path has since
  been claimed.`

Do not report “held by a deleted document” after this migration. Finding one or several deleted
rows at the same path is normal. A mismatch between path and version liveness is an invariant
failure for diagnostics and tests, not an editorial conflict category.

### Media retention

Original uploaded files are immutable source assets and survive soft delete. The required phase
also retains generated variants. Existing cleanup in
`packages/core/src/services/document-lifecycle/delete.ts` is removed, including:

- reconstruction solely for collecting storage paths;
- original and variant `storage.delete()` calls;
- `storageCleanup` as a delete side-effect failure phase;
- tests and documentation that promise destructive storage cleanup.

`afterDelete` and `afterTreeChange` remain post-commit side effects for search, cache, and tree
invalidation.

Hard delete/purge will eventually own irreversible source cleanup. It must reason across every
immutable version and any shared stored-file references; it is not a renamed soft-delete step.

### Deliberate scope coupling and operational consequence

Media retention is intentionally included with issue #69 rather than split into an independent
implementation. A path-level un-delete primitive would otherwise appear to make documents
recoverable while soft delete had already destroyed their source assets. The two changes complete
one recoverability invariant and should be reviewed together.

The operational consequence is also explicit: after this lands, soft deletion reclaims no object
storage, and Byline still has no supported hard-delete/purge command. Installations close to a
storage quota must account for that behavior before upgrading. This phase does not ship an interim
destructive maintenance script; such a script would bypass the reference, immutable-version, and
future retention decisions deliberately deferred to purge design. The changeset, release notes,
and media-upload documentation must call out this tradeoff.

## Current-state findings

- Both adapters soft-delete every version and leave `byline_document_paths` unchanged.
- `getDocumentByPath` first resolves a raw path row and then compares it with a current-document
  view. Once live and deleted rows can share a path, the subquery must explicitly filter `alive =
  true` or it may select a deleted row nondeterministically.
- MySQL's path-constraint name is parsed from the driver error text and must not change.
- `import-docs-force.ts` revives deleted versions with PostgreSQL-specific raw SQL and compensating
  re-tombstoning.
- `media-ingest.ts` uses the same revival helper for deleted media occupants.
- That workaround cannot survive the new marker unchanged: it writes only version tombstones, so
  it would leave the path row inactive and silently create a live document that `findByPath`
  cannot resolve. Its path-only occupant query also becomes ambiguous once several tombstones may
  retain the same path.
- The importer is already a normal path-based upsert without `--force`: update a live occupant,
  otherwise create. Releasing deleted path ownership removes the only collision that `--force`
  exists to bypass.
- `--tree` places every imported result by its returned document ID, so a new ID after
  delete-and-reimport is placed normally.
- `regenerate-media.ts` reads only live documents and deletes only objects created by its own
  failed run. `regenerate-media-operation.ts` uses stored paths for collision detection. Neither
  relies on soft-delete cleanup or deleted-path lookup.
- Soft delete currently reads the current reconstructed document and physically deletes original
  files and persisted variants after the database commit.
- `duplicateDocument` routes path conflicts through the same mapper, then retries with a
  short-UUID suffix. Releasing deleted path ownership changes its first-attempt outcome and needs a
  regression test.
- `IStorageProvider` can upload and delete, but has no provider-neutral read/download capability.
- Persisted variant metadata records output name/path/dimensions/format, but not the complete input
  recipe (`fit`, requested bounds, quality, processor/version).
- `duplicateDocument` and successive immutable versions can retain the same stored-file paths.
  Variant deletion therefore requires live-reference analysis rather than assuming one document
  exclusively owns an object.

---

## Task 0: Prove the generated-column model before implementation

**Status:** Complete on 2026-07-30. The generated-column model passed on both supported
databases; use the primary design in Tasks 1–10.

The generated `alive` column is load-bearing. Type-level support and Drizzle's in-memory column
configuration are not sufficient evidence that the pinned toolchain emits and migrates the
required schema on both databases.

### Probe

- [x] Create disposable PostgreSQL and MySQL probe schemas using the repository's pinned
  `drizzle-orm` 0.45.2 and `drizzle-kit` 0.31.10.
- [x] Declare the proposed `deleted_at`, generated stored `alive`, and four-column unique
  constraint through the same builders intended for the production schemas.
- [x] Run each package's real Drizzle generation path.
- [x] Inspect the emitted SQL and snapshot metadata. Require:
  - a stored generated boolean column on both dialects;
  - `CASE WHEN deleted_at IS NULL THEN true ELSE NULL END` or an exactly equivalent expression;
  - the named unique constraint/index over `(collection_id, locale, path, alive)`;
  - no insert/update requirement for callers to supply `alive`.
- [x] Apply each disposable migration to a real supported database.
- [x] Prove with SQL-level assertions that:
  - two live rows at one `(collection, locale, path)` conflict;
  - multiple rows with the same key and `deleted_at IS NOT NULL` coexist;
  - clearing one tombstone's `deleted_at` conflicts when a live occupant exists;
  - clearing it succeeds after the live occupant is deleted.
- [x] Record the generated SQL result in this spec or the implementation handoff so the assumption
  is not repeatedly re-investigated.

### Result

The probe used the pinned `drizzle-orm` 0.45.2 and `drizzle-kit` 0.31.10 packages installed in
each adapter workspace. Drizzle generated these definitions:

```sql
-- PostgreSQL
"deleted_at" timestamp (6) with time zone,
"alive" boolean GENERATED ALWAYS AS (
  CASE WHEN "deleted_at" IS NULL THEN true ELSE NULL END
) STORED,
CONSTRAINT "idx_document_paths_collection_locale_path"
  UNIQUE("collection_id","locale","path","alive")
```

```sql
-- MySQL
`deleted_at` datetime(6),
`alive` boolean GENERATED ALWAYS AS (
  CASE WHEN `deleted_at` IS NULL THEN true ELSE NULL END
) STORED,
CONSTRAINT `idx_document_paths_collection_locale_path`
  UNIQUE(`collection_id`,`locale`,`path`,`alive`)
```

Both generated snapshots record `alive` as nullable, generated, and stored, and record the exact
four-column constraint name and order. Ordinary inserts omitted `alive`.

The migrations were applied to disposable tables on PostgreSQL 18.4, local-development MySQL
9.7.1, and the CI-pinned `mysql:8.0` image, which resolved to MySQL 8.0.46 during the probe. All
three server runs passed the four SQL-level transitions: a second live claimant failed, multiple
deleted claimants coexisted, restoration over a live claimant failed, and restoration succeeded
after the live claimant was deleted. Catalog inspection confirmed `ALWAYS ... STORED` on
PostgreSQL and `STORED GENERATED` on both MySQL versions. The disposable tables, PostgreSQL probe
schema, and MySQL 8.0 container were removed after verification.

### Fallback if either dialect fails

Stop before Task 1 and revise this plan to use a plain nullable boolean `alive`:

- live rows store `true`;
- deleted rows store `NULL`;
- create/path upsert establishes `true`;
- soft delete writes `deleted_at` and `alive = NULL` in the same transaction;
- storage un-delete clears `deleted_at` and writes `alive = true` in the same transaction;
- migration and invariant tests cover drift between `deleted_at`, `alive`, and version tombstones.

The fallback preserves portable uniqueness but gives up the database-derived invariant. Task 4,
the migration backfill, and invariant diagnostics must be rewritten explicitly before proceeding.
The completed probe did not trigger this fallback.

## Task 1: Pin the behavior with shared failing tests

**Status:** Complete as test definition on 2026-07-30. These checkboxes record that the contract
coverage exists; implementation-dependent assertions remain intentionally red until the later
tasks make them green.

**Files**

- Modify: `packages/db-conformance/src/suites/document-paths.ts`
- Modify: the shared adapter conformance registration if a new suite is clearer
- Modify: `packages/core/src/services/document-lifecycle.test.node.ts`
- Modify: focused PostgreSQL/MySQL storage-command tests where driver-level locking or error
  anatomy needs direct coverage

### Tests

- [x] A live duplicate still violates `idx_document_paths_collection_locale_path`.
- [x] Soft delete releases a path for a new live document.
- [x] Two or more deleted documents retain the same path.
- [x] `getDocumentByPath` returns the live document when deleted documents retain the same path.
- [x] Duplicate-to-path succeeds without suffixing when only deleted rows retain the target path.
- [x] Duplicate-to-path retains its suffix/retry behavior when a live row owns the target path.
- [x] Un-delete restores all version tombstones and the original path.
- [x] Un-delete conflict rolls back path and version liveness.
- [x] Missing/already-live un-delete is idempotent.
- [x] Soft-delete and un-delete transaction rollback leave both tables synchronized.
- [x] `createDocumentVersion({ documentId })` refuses to add a live version to a fully deleted
  existing document; a concurrent version-write/soft-delete race leaves version and path liveness
  synchronized.
- [x] Tree locking behavior remains serialized.
- [x] Soft delete does not call `storage.delete()` for sources or variants.
- [x] `afterDelete` and `afterTreeChange` failure reporting remains unchanged apart from removal of
  `storageCleanup`.

The shared suite should exercise public adapter contracts. Keep dialect-only tests only for
generated DDL, lock behavior, driver classification, and migration backfill.

## Task 2: Add `deleted_at`, generated `alive`, and the live unique constraint

**Status:** Complete on 2026-07-30.

**Files**

- Modify: `packages/db-postgres/src/database/schema/index.ts`
- Modify: `packages/db-mysql/src/database/schema/index.ts`
- Modify: schema pin tests in both adapters
- Generate for development: PostgreSQL and MySQL Drizzle migrations and snapshots under each
  adapter's `src/database/migrations/`
- Create: `packages/db-postgres/sql/0006_soft_delete_path_liveness.sql`
- Create: `packages/db-mysql/sql/0001_soft_delete_path_liveness.sql`
- Leave unchanged in this feature: `packages/cli/src/templates/migrations/postgres` and
  `packages/cli/src/templates/migrations/mysql`

### Implementation

- [x] Add nullable `deleted_at` to `documentPaths`.
- [x] Add generated stored nullable boolean `alive`.
- [x] Rebuild `idx_document_paths_collection_locale_path` over
  `(collection_id, locale, path, alive)` without changing its name.
- [x] Keep `unique_document_paths_document_locale` unchanged on `(document_id, locale)`; deletion
  changes the existing row's liveness and does not create path-history rows.
- [x] Generate development migrations with the package-local Drizzle commands.
- [x] Inspect the generated SQL and snapshots; do not format migration metadata manually. This
  Drizzle stream supports adapter development and is not the upgrade path for deployed databases.
- [x] Create one final, numbered, hand-written upgrade script per provider under
  `packages/db-postgres/sql/` and `packages/db-mysql/sql/`. Base their DDL on the inspected
  Drizzle output, include the data backfill, and follow each directory's idempotency and
  transactional conventions.
- [x] Backfill `deleted_at` for a path row only when its document has at least one version and no
  non-deleted version exists.
- [x] Use the latest version `updated_at` as the best available historical deletion timestamp,
  with a documented fallback for malformed legacy rows that have versions. Keep versionless
  bootstrap documents live because no deletion occurred.
- [x] Treat a partially revived legacy document with any non-deleted version as live.
- [x] Verify the expression is a stored generated column in both real databases.
- [x] Preserve case/accent-sensitive MySQL path behavior and index length compatibility.
- [x] Test both native upgrade scripts against already-provisioned databases and prove they are
  safely rerunnable.
- [x] Do not copy the development Drizzle migrations into the CLI during this feature. Before
  release, squash each adapter's Drizzle stream to its single fresh-install baseline, then run the
  CLI baseline synchronization and drift gates.

### Migration-order check

Neither the development Drizzle migration nor the native upgrade script may leave a completed
state in which deleted rows are marked live under the new uniqueness contract. PostgreSQL can run
the data and DDL changes transactionally. MySQL DDL auto-commits, so order and guard its native
script to be safely rerunnable after interruption, and document any required operator inspection
when a fully atomic sequence is impossible.

### Result

The development migrations and native upgrade scripts were applied to isolated databases created
from each adapter's existing Drizzle baseline on PostgreSQL 18.4, MySQL 9.7.1, and the CI-pinned
MySQL 8.0 image, which resolved to 8.0.46. Fixtures covered a fully deleted document, a partially
revived document, and a versionless bootstrap document. Both migration paths assigned the fully
deleted path the latest version timestamp and kept the partially revived and versionless paths
live.

Catalog inspection confirmed PostgreSQL `attgenerated = 's'` and MySQL `STORED GENERATED`.
The live key retained its name and exact `(collection_id, locale, path, alive)` order, while
`unique_document_paths_document_locale` remained `(document_id, locale)`. A new live document
claimed a deleted occupant's path, a second live claimant remained blocked, and MySQL admitted
case- and accent-distinct paths under the rebuilt key. Both native scripts completed successfully
on a second run; the MySQL development migration uses one atomic `ALTER TABLE` for the index swap
because InnoDB may use the old unique key to support the collection foreign key. Both native
scripts reject drift in either direction between path and version liveness, and MySQL returns a
nonzero exit status when any post-condition fails.

The CLI template directories remained unchanged. Their baselines will be synchronized only after
the adapter Drizzle streams are squashed for release.

## Task 3: Make live-path reads explicit

**Status:** Complete as read-path implementation on 2026-07-30. The shared soft-delete
end-to-end assertions remain intentionally red until Task 4 synchronizes path and version
liveness.

**Files**

- Modify: `packages/db-postgres/src/modules/storage/storage-queries.ts`
- Modify: `packages/db-mysql/src/modules/storage/storage-queries.ts`
- Modify: related filter/relation path compilers if they resolve a document ID from an unscoped
  path row
- Modify: shared document-path conformance tests
- Create: focused PostgreSQL/MySQL live-path query integration tests

### Implementation

- [x] Add `alive = true` to every path-to-document lookup that addresses the live namespace.
- [x] Preserve the determinism invariant: the unique constraint supplies the within-locale
  singleton; locale-chain ordering supplies cross-locale priority. Do not add a row-ID tiebreaker
  that masks a weakened uniqueness constraint.
- [x] Do not filter `alive` from path projection by a known document ID; deleted-document
  administration must still be able to display retained paths.
- [x] Audit relation filters and locale fallback queries for raw path-row lookups.
- [x] Prove locale priority remains deterministic when deleted and live rows share a path.
- [x] Ensure normal live reads never expose `deleted_at` or `alive` as document fields.

### Result

Both adapters now apply `alive = true` in their single live-namespace resolver,
`resolveDocumentIdByPath`. The locale-chain ordering remains the only cross-locale priority rule;
no row-ID tiebreaker was added. `pathProjection` remains intentionally unfiltered because it
projects a retained path for an already-known document identity, including history and nested
relation-filter contexts. The shared conformance suite now pins the case where a deleted row in
the requested locale must be skipped before a live default-locale fallback is selected, and
asserts that live document envelopes expose neither liveness column.

Focused adapter integration tests established the read contract independently from Task 4 by
constructing synchronized path/version liveness directly. Task 4 converted those fixtures to
exercise the production soft-delete command while retaining the same assertions: the resolver
skips a deleted requested-locale row, falls back to the live default-locale row, and still projects
the deleted row's retained path when history is addressed by known document identity.

## Task 4: Synchronize soft delete and retain media

**Status:** Complete on 2026-07-30.

**Files**

- Modify: `packages/db-postgres/src/modules/storage/storage-commands.ts`
- Modify: `packages/db-mysql/src/modules/storage/storage-commands.ts`
- Modify: `packages/core/src/services/document-lifecycle/delete.ts`
- Modify: `packages/core/src/services/document-lifecycle/context.ts`
- Modify: `packages/host-tanstack-start/src/server-fns/collections/delete-outcome.ts`
- Modify: `packages/host-tanstack-start/src/server-fns/collections/delete-outcome.test.node.ts`
- Modify: delete lifecycle/storage tests
- Modify: exported delete result types and downstream tests

### Storage command

- [x] Capture one operation timestamp.
- [x] Under the existing collection/document locks, set that timestamp on every path row.
- [x] Set every version `is_deleted = true` in the same transaction.
- [x] Preserve the existing return value unless a richer result is required by a proven caller.
- [x] Verify nested/ambient adapter transactions preserve the outer audit/tree atomic boundary.

### Lifecycle cleanup

- [x] Stop reconstructing upload fields solely for deletion cleanup.
- [x] Remove source and variant path collection.
- [x] Remove all soft-delete `storage.delete()` calls.
- [x] Remove `storageCleanup` from `DeleteDocumentSideEffectPhase`.
- [x] Remove `storageCleanup` from downstream result sanitization and allowlists; do not reserve
  the soft-delete phase name for a future purge operation.
- [x] Preserve original-path capture for `beforeDelete`/`afterDelete`.
- [x] Preserve search/cache/tree invalidation and allowlisted side-effect reporting.
- [x] Update comments that currently describe soft delete as physically removing objects.

### Result

Both adapters now take their existing collection and document locks, capture one timestamp, mark
every path row inactive with that timestamp, and mark every version deleted with the same
`updated_at` value in one transaction. The command still returns the number of affected version
rows. Focused live-database tests cover multiple locale path rows and multiple versions, and prove
that every touched row shares the operation timestamp. Shared conformance tests prove path release,
reuse, locale fallback, duplicate-path discrimination, the existing-version-write race, and
ambient transaction rollback on PostgreSQL and MySQL.

The lifecycle now fetches only the non-reconstructed document envelope needed to preserve the
original path for delete hooks. It retains upload sources and variants and never calls
`storage.delete()` during soft delete. `storageCleanup` is no longer an exported delete side-effect
phase or a host transport allowlist value; an old or malformed occurrence is sanitized to
`unknown`. `afterDelete` and `afterTreeChange` reporting, audit/tree atomicity, and post-commit
invalidation behavior remain unchanged.

The focused document-path conformance run is now 17 passed and 6 intentionally failed on each
adapter. Every remaining failure belongs to Task 5: five require the absent restoration primitive,
and one requires the fully-deleted existing-document version-write guard coupled to that primitive.

## Task 5: Add the storage-level un-delete command

**Status:** Complete as a storage primitive on 2026-07-30. No production lifecycle, route, client,
importer, or administrator caller was added.

**Files**

- Modify: `packages/core/src/@types/db-types.ts`
- Modify: `packages/db-postgres/src/modules/storage/storage-commands.ts`
- Modify: `packages/db-mysql/src/modules/storage/storage-commands.ts`
- Modify: adapter mocks throughout core/package tests
- Modify: shared conformance tests

### Contract

Add as a **required** member of `IDocumentCommands`:

```ts
restoreSoftDeletedDocument(params: { document_id: string }): Promise<number>
```

`IDocumentCommands` is a public export of `@byline/core` (`src/index.ts` → `@types/index.ts` →
`db-types.js`), so this is a contract addition every adapter must satisfy, including out-of-tree
implementations. It is required rather than optional deliberately: an adapter that cannot un-delete
cannot support the planned trash/restore surface, and permanent optionality would push a capability
check into every future call site. See review decision 7 for the release handling.

This phase ships the primitive with **no production caller**. The shared conformance suite exercises
it; the importer is explicitly forbidden from using it (Task 7), and there is no route, client
method, or administrator interface yet. That gap is intended — the primitive is the foundation the
future lifecycle restore and trash UI build on, and landing it now keeps both adapters in step while
the storage semantics are being tested. Reviewers should not read the absence of a caller as
incompleteness.

### Implementation

- [x] Take the same collection then document locks as soft delete.
- [x] Return `0` when the document is missing.
- [x] Return `0` when any version is already live; do not “repair” a partially live document
  implicitly.
- [x] Make whole-document un-delete the only supported way to add live versions to a fully deleted
  existing document. Both adapters' `createDocumentVersion({ documentId })` path must reject that
  state rather than inserting a non-deleted version while leaving its path rows inactive.
- [x] Preserve the legitimate versionless-document bootstrap case: an existing document row with
  no versions may still receive its first version.
- [x] Serialize that existing-document liveness check with soft delete and un-delete at the
  document lock boundary, and verify the race without introducing collection-wide serialization
  for ordinary version writes.
- [x] Set every path row `deleted_at = NULL`.
- [x] Set every version `is_deleted = false`.
- [x] Keep both updates in one adapter transaction.
- [x] Preserve every version status and all path values.
- [x] Let a path unique violation abort the transaction and flow through adapter classification.
- [x] Verify two concurrent restore/create operations have one deterministic winner.
- [x] Document that tree placement and search/cache projections are not reconstructed.

### Invariant diagnostics

Add focused tests or an internal assertion helper for impossible supported-command states:

- live versions with every path row deleted;
- fully deleted versions with an active path row;
- mixed live/deleted version tombstones after a completed whole-document operation.

Legacy import tooling has created mixed version tombstones by reviving one version and leaving
historical versions deleted. Migration must tolerate that shape: any non-deleted version keeps the
path active, `restoreSoftDeletedDocument` returns `0`, and migration validation reports it as a
known legacy-partial state rather than failing or calling it a post-command invariant violation.
Removing importer `--force` means no supported repository workflow continues producing this
shape; it is migration compatibility, not a permanent write contract. The “mixed tombstones are
impossible” assertion applies only to a newly completed supported whole-document soft-delete or
un-delete command.

Do not make ordinary reads execute expensive invariant checks. Keep them in migration validation,
tests, and explicit maintenance diagnostics with the legacy distinction above.

### Result

`IDocumentCommands` now requires `restoreSoftDeletedDocument`. Both built-in adapters take the same
collection then document locks as soft delete, restore only a fully deleted state, reactivate every
path row before restoring every version, and let the live path unique constraint abort the entire
transaction when a path has been reclaimed. Missing, versionless, already-live, and legacy
partially-live documents return `0`. Restoration preserves statuses and path values and
deliberately does not reconstruct tree placement or search/cache projections.

Existing-document version creation now takes only its target document lock, checks the existing
version set, and rejects a fully deleted document before inserting. Documents with no versions
remain valid bootstrap targets, and a legacy partial state remains writable because at least one
version is already live. This document-level lock serializes ordinary writes with soft delete and
un-delete without adding collection-wide serialization to normal edits.

Focused live-database tests on both adapters verify two path rows and two versions transition
together with one restoration timestamp, preserve two workflow statuses and both path values, leave
a deliberately constructed legacy partial state untouched, and permit versionless bootstrap. The
shared document-path conformance suite is now 23 passed on both PostgreSQL and MySQL, including
rollback and path-conflict cases; the complete adapter conformance file is 159 passed on each
provider. The two concurrency cases passed five repeated runs per adapter, and the full workspace
typecheck completed 36 of 36 tasks successfully.

## Task 6: Improve operation-specific path conflicts

**Files**

- Modify: `packages/core/src/services/document-lifecycle/internals.ts`
- Modify: create/update/system-field/duplicate lifecycle call sites
- Modify: `packages/core/src/services/document-lifecycle/duplicate.ts`
- Modify: lifecycle error tests
- Modify: duplicate lifecycle tests
- Modify: any internal wrapper added for storage-level restoration

### Implementation

- [ ] Preserve the `ERR_PATH_CONFLICT` code.
- [ ] Preserve `path`, `locale`, and constraint details.
- [ ] Use live-occupant language for create/update.
- [ ] Thread the same language through both `duplicateDocument` conflict mapping calls without
  changing its live-conflict retry classifier.
- [ ] Pin the improved first-attempt behavior when a deleted row is the only retained occupant:
  duplication keeps the requested path and does not append a short-UUID suffix.
- [ ] When a core restoration wrapper is introduced, use reclaimed-original-path language.
- [ ] Do not issue a second occupant query merely to label a deleted row; the unique constraint can
  collide only with an active row.
- [ ] Avoid exposing the occupant document ID through public error details.

## Task 7: Retire importer `--force` and preserve plain upsert behavior

**Files**

- Remove: `apps/webapp/byline/scripts/lib/import-docs-force.ts`
- Remove: `apps/webapp/byline/scripts/lib/import-docs-force.test.node.ts` — it covers only the
  removed helper (`ImportDocsForceDatabase`, `importDocsForceLockKey`,
  `replaceDeletedDocumentAtPath`) and has nothing to preserve
- Modify: `apps/webapp/byline/scripts/import-docs.ts`
- Modify: `apps/webapp/byline/scripts/lib/media-ingest.ts`
- Modify: `apps/webapp/byline/scripts/lib/media-ingest.test.node.ts` if it asserts on the removed
  reclaimed-occupant counter
- Modify: importer command help
- Verify unchanged: `apps/webapp/byline/scripts/lib/import-docs-tree.ts`
- Verify unchanged: `apps/webapp/byline/scripts/regenerate-media.ts`
- Verify unchanged: `apps/webapp/byline/scripts/regenerate-media-operation.ts`

### Implementation

- [ ] Remove every raw `UPDATE ... SET is_deleted = ...` operation.
- [ ] Remove the deleted-document `--force` flag, help text, advisory lock, staging snapshots,
  compensation paths, and manual `afterDelete` replay.
- [ ] Keep the importer as a plain path-based upsert:
  - `findByPath` returns a live occupant → update it;
  - no live occupant → create a new logical document;
  - deleted tombstones at the path do not participate.
- [ ] Do not make the importer call `restoreSoftDeletedDocument`. Identity-preserving un-delete
  requires an explicitly selected document ID and belongs to a future trash/restore workflow.
- [ ] Keep upload compensation for a newly uploaded source whose subsequent document operation
  fails; that rollback is unrelated to soft delete.
- [ ] Remove the media-ingest deleted-occupant revival branch and its “re-run with `--force`”
  diagnostic; normal create now succeeds.
- [ ] Remove `force` and `pool` from the media-ingest options shape and the reclaimed-occupant
  counter from its result/summary output. Both are part of the ingest function's signature and its
  user-visible summary, so update the `import-docs.ts` call site and any test asserting the counter.
- [ ] Drop the now-dead `resolveHooks` / `normalizeCollectionHook` imports in `import-docs.ts`,
  used only by the removed compensation branch's manual `afterDelete` replay.
- [ ] Pin delete-then-reimport behavior: the new ID is returned and subsequently resolved by path.
- [ ] Pin `--tree` behavior against the new ID.
- [ ] Run or extend focused tests proving both media-regeneration scripts continue to operate only
  on live documents and retain their existing rollback/collision behavior.

### Adapter-neutrality outcome

Removing `--force` also removes the importer's only dependency on PostgreSQL adapter internals, and
that is a deliberate outcome of this task rather than incidental deletion. The raw pool exists
solely to back the workaround: `import-docs.ts` casts `getBylineCore().db as PgAdapter`, threads
`adapter: PgAdapter` down through its per-file processor, and passes `adapter.pool` into media
ingest, whose own `pool` option is typed `ImportDocsForceDatabase`. With the workaround gone, none
of that plumbing has a consumer.

- [ ] Remove the `PgAdapter` cast, the `adapter` parameter threading, and the `adapter.pool`
  plumbing once `--force` is gone.
- [ ] Verify no remaining consumer of the `adapter` value exists besides the removed force
  plumbing before deleting it.
- [ ] Confirm the importer's remaining database access is adapter-neutral client API usage.

The reference importer is currently the repository's own counter-example to the adapter
abstraction — it would not run against MySQL. Completing this task makes it dialect-neutral, which
matters now that MySQL is a supported adapter and further adapters are anticipated. If any residual
dialect-specific access is discovered during implementation, record it rather than leaving the claim
overstated.

### Identity consequence

Delete followed by re-import intentionally splits history across two logical document IDs: the old
document and its audit trail remain deleted, while the new import starts a new document history at
the same path. URLs remain stable because delivery is path-based, current collections do not
declare relationships to the imported docs collection, and `--tree` reconstructs placement from
the directory layout. This is the consistent result of “update when live, create when absent.”

## Task 8: Record a follow-on variant-retention investigation

Do not implement variant deletion or regeneration in this phase. Open a separate design issue after
this plan is approved and link it from issue #69.

The follow-on investigation should cover:

- whether variant storage paths remain persisted immutable identities or are derived dynamically
  from rules;
- migration and compatibility behavior if path rules change;
- whether regenerated output must be byte-identical or only contract-equivalent;
- the generation recipe that must be persisted, including requested dimensions, fit, format,
  quality, and processor/version;
- a provider-neutral way to read retained source bytes;
- reference safety when immutable versions or duplicated documents share stored-file paths;
- legacy variants whose complete generation recipe is unavailable;
- retry and idempotency behavior across external storage and database state;
- whether cleanup applies only to current-version variants or every immutable version.

Until that issue is designed and approved, generated variants have the same retention behavior as
their source files.

## Task 9: Documentation and issue alignment

**Files**

- Modify: `docs/04-collections/05-document-paths.md`
- Modify: `docs/03-architecture/01-document-storage.md`
- Modify: `docs/03-architecture/03-transactions.md`
- Modify: `docs/04-collections/06-file-media-uploads.md`
- Modify: `docs/04-collections/04-document-trees.md`
- Modify: `docs/05-reading-and-delivery/01-client-sdk.md`
- Modify: `docs/07-auth-and-security/02-auditability.md`
- Create: a Changesets release note under `.changeset/`
- Modify: issue #69 only after this plan is approved

### Documentation

- [ ] Document `deleted_at`, generated `alive`, and live-only uniqueness.
- [ ] Document soft-delete/un-delete atomicity and conflict behavior.
- [ ] State that soft delete retains path values, versions, fields, and source assets.
- [ ] State that generated variants are retained in this phase.
- [ ] State prominently that soft delete no longer reclaims object storage and no supported purge
  operation exists yet.
- [ ] Add a changeset covering the path, un-delete, and media-retention behavior changes for the
  fixed Byline package group.
- [ ] Document the PostgreSQL and MySQL numbered native upgrade scripts for existing
  installations. Do not direct existing installations to the development Drizzle migration or
  the future squashed fresh-install baseline.
- [ ] State in the changeset that `IDocumentCommands` gains a required `restoreSoftDeletedDocument`
  member, and tell out-of-tree adapter authors what they must implement. Both built-in adapters ship
  the implementation, so the break is only visible to external `IDbAdapter` implementations.
- [ ] Update importer documentation/help to describe plain upsert behavior, removal of the
  deleted-document `--force` workaround, and the new-document-ID consequence after re-importing a
  deleted path.
- [ ] Distinguish un-delete from historical-version restore.
- [ ] State that tree placement is not reconstructed.
- [ ] State that storage-level un-delete does not reconstruct search indexing. The future
  lifecycle API must restore search/cache projections before it becomes a supported editorial
  operation.
- [ ] Reserve irreversible source cleanup for future purge.
- [ ] Run `pnpm docs:check` and `git diff --check`.

## Task 10: Verification gates

### Package-local iteration

- [ ] Run focused core lifecycle unit tests.
- [ ] Run shared db-conformance against PostgreSQL.
- [ ] Run shared db-conformance against MySQL.
- [ ] Run each adapter's schema pin and development Drizzle migration tests.
- [ ] Apply each adapter's numbered native `sql/` upgrade script twice and verify the second run is
  a no-op.
- [ ] Exercise both development and native upgrade migrations against databases containing:
  - a live document;
  - a fully deleted document;
  - a legacy partially revived document, which remains active, returns `0` from un-delete, and is
    reported as legacy-partial rather than rejected;
  - a deleted path later reclaimed after migration.

### Repository gates

Run in CI static-gate order:

```bash
pnpm byline:generate:check
pnpm lint
pnpm typecheck
pnpm knip
```

Then run:

```bash
pnpm test
pnpm test:integration
pnpm docs:check
pnpm build
git diff --check
```

Check build exit status rather than treating known Lexical `INVALID_ANNOTATION` warnings as
failures.

### Release-only database gates

Do not synchronize the feature's incremental Drizzle migrations directly into the CLI. During
release preparation, after both adapter Drizzle streams have been squashed to one fresh-install
baseline, run the repository's guarded baseline workflow:

```bash
pnpm --filter @byline/cli sync:baselines
git diff --exit-code -- packages/cli/src/templates/migrations
pnpm --filter @byline/cli exec vitest run src/lib/baseline-drift.test.ts
pnpm check:native-sql-history -- --base "v<previous-version>"
```

The first three commands verify and copy the squashed fresh-install baselines. The native SQL
history guard separately protects the append-only PostgreSQL and MySQL upgrade scripts used by
existing installations.

## Review decisions and confirmed positions before implementation

1. **Storage un-delete status semantics:** approve the faithful storage inverse (all versions live,
   statuses preserved). A future public lifecycle restore may separately enforce draft status.
2. **Importer identity policy:** confirmed by this plan: plain upsert creates a new document when
   no live occupant exists, importer `--force` is removed, and any future identity-preserving
   un-delete requires an explicit document ID.
3. **Generated variants:** approve retaining variants in this phase and handling cleanup,
   regeneration, and persisted-versus-dynamic path rules in a separate follow-on issue.
4. **Retention timestamp:** approve path-row `deleted_at` as the path-reservation release time,
   while leaving open whether a future document-level retention model also adds
   `byline_documents.deleted_at`.
5. **Lifecycle surface:** confirm that this phase stops at the storage command. A future
   `restoreDeletedDocument` lifecycle API will own authorization, audit, hooks, status policy,
   cache/search restoration, and the administrator UI. Invoking the faithful storage inverse
   directly can immediately republish previously published content without rebuilding search.
6. **Media scope and operations:** confirm that media retention intentionally remains coupled to
   issue #69, that the storage-growth consequence is release-noted, and that no interim
   destructive maintenance script ships before purge/reference semantics are designed.
7. **Adapter contract change:** decided — `restoreSoftDeletedDocument` is a **required** member of
   `IDocumentCommands`, not an optional method behind a capability check. `IDocumentCommands` is a
   public export of `@byline/core`, so any out-of-tree adapter must implement it to compile; both
   built-in adapters ship implementations, so in-repo consumers see no break. The reasoning is that
   an adapter unable to un-delete cannot support the planned trash/restore surface, and optionality
   would embed a permanent capability check at every future call site for a primitive every adapter
   genuinely needs. The changeset must call the addition out for external adapter authors.

   Accepted alongside this: the primitive ships with no production caller in this release. The
   conformance suite is its only exercise, the importer is forbidden from using it, and no route or
   client method is added. That is a deliberate foundation-first sequencing choice, not an
   unfinished edge.
