---
title: "Stale document write protection Task 6 evidence"
path: "stale-document-write-protection-task6"
summary: "Implementation and verification evidence for revision-guarded lifecycle and maintenance mutations at the R3a checkpoint."
---

# Stale document write protection Task 6 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines the joint Tasks 5–6 R3a gate.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the complete release contract.
- [Task 5 evidence](./2026-09-05-stale-document-write-protection-task5.md) records the atomic save implementation and T5-1 correction.
- [R0 decisions](./2026-09-05-stale-document-write-protection-r0.md) define transaction ownership and the media replacement.

Task 6 is implemented and verified; The reviewer resolved R3a-1/2/3 and closed T5-1. R3a passed independent review on 2026-09-05, including the deterministic R3a-4(a) storage-race correction below. The final verdict and carried items are recorded in the implementation plan. This note is implementation evidence, not an independent R3a verdict. R1-1 and R2-1 remain assigned to later tasks.

## Implementation and coverage

| Ledger IDs / area | Implementation | Executable evidence |
| --- | --- | --- |
| L02 / status and unpublish | Required caller revision; authorized coherent preflight before hooks; final document/parent guard; transactional status, cancellation, audit, and one advance. Current no-ops retain the revision. Status operations create no content version. | Shared `guarded-saves.ts`, `Task 6 remaining lifecycle guards`: stale/missing inputs, current outcomes, no-ops, rollback, stale publish after preparation, and committed after-hook receipts. Existing workflow and SDK suites remain active. |
| L02, S01 / restore and locale operations | Historical source identity stays separate from the current target revision. Restore, copy and locale deletion guard their new immutable version and schedule suspension together. Locale deletion protects the document's own source locale. A copy whose stored target payload is unchanged retains its version/revision. Singleton preparation and hooks run outside the final slot/document lock interval. | Shared guard matrix and `singleton-lifecycle.ts`: stale/missing singleton status, unpublish, restore and copy; successful receipts; unchanged copy; source-version and hook discriminator tests. Existing first-save race coverage remains in the suite. |
| L02, T01 / deletion | Guarded target deletion retains files, tombstones, audit and the existing committed side-effect outcome. Both success and committed-warning transports carry the revision. Collection locking precedes document locking for every guarded lifecycle write. Version, path and audit foreign keys can acquire shared collection locks, while deletion and maintenance take the collection mutex explicitly. The conservative common order prevents those paths from inverting the two lock classes. | Shared guard matrix; lock-order assertions for every converted flat operation plus replacement and metadata; a competing content-save/delete case; existing tree/delete audit, path, media-retention and SDK invalidation tests. Derived structural revisions remain Task 7. |
| L02 / duplication | Authorize create and source read, capture the source revision before preparation, and guard the source while creating the destination. Destination begins at revision 1; source revision and schedule remain unchanged. No automatic refresh/retry on staleness. The existing new-copy path-collision retry stays inside the same guarded transaction. | Shared matrix; duplicate losing a race after preparation; injected failure after real destination insertion proves destination rollback and unchanged source. Counter tests retain fresh-copy counter behavior. |
| M01, T5-1 / media replacement | `replaceDocumentFieldsPreservingStatus` owns the transaction and requires ordinary update plus `system.documentMaintenance` authorization; preserving a published status also requires publish authorization. It accepts no status override. It preserves any currently declared observed status, archives superseded published content, suspends an armed schedule, advances once, and deliberately emits no false `document.status.changed` audit. | Thirteen shared real-adapter tests cover draft/published/archived/custom statuses, undeclared status, permissions, external transactions, stale processing output, archive/audit/revision rollback, and a committed after-hook failure. |
| M01 / PostgreSQL re-anchor | `PgAdapter.reAnchorDocument` requires the caller revision; bulk maintenance requires an explicit target list. Each target owns a collection/document/schedule-ordered transaction. Dry runs and no-ops validate the observation without advancing. Actual changes preserve status, archive superseded publication, audit source-locale change, suspend armed schedules and advance once. Batches stop on stale input without refreshing it; earlier committed targets remain committed. | PostgreSQL `storage-document-paths-reanchor.test.ts`: guarded dry-run/no-op/current/stale cases, external/missing input, full rollback and explicit batch observations; original canonical-path test retained. |
| D01, M01 / internal un-delete and startup | Un-delete requires an observed revision under collection/document locks, advances only on an actual restore, and cancels any schedule retained by legacy/raw maintenance. It preserves its internal affected-version count result; it is not a new SDK operation. NULL-only source-locale normalization remains unchanged and does not churn revisions on startup. | Shared `document-paths.ts` un-delete precondition/advance/stale-no-op case, plus existing restore rollback, uniqueness and liveness tests. Existing boot and migration suites remain active. |
| H01 / receipts and callers | SDK and host signatures require observed revisions. Edit/history/singleton actions pass their loaded current revision; historical version IDs do not substitute for it. The import script carries each returned revision into the next workflow transition. Common committed-hook revisions are now required, including status/unpublish phases. | Root typecheck; SDK, host and core suites; transport receipt assertions and runtime committed-envelope validation. Full stale-message UI behavior remains Task 9. |

Source entry points are under [core document lifecycle](../packages/core/src/services/document-lifecycle/index.ts), [singleton lifecycle](../packages/core/src/services/singleton-lifecycle/internals.ts), the [collection SDK](../packages/client/src/collection-handle.ts), [singleton SDK](../packages/client/src/singleton-handle.ts), and [PostgreSQL adapter](../packages/db-postgres/src/index.ts). Shared coverage is in [guarded saves](../packages/db-conformance/src/suites/guarded-saves.ts), [singleton lifecycle](../packages/db-conformance/src/suites/singleton-lifecycle.ts), and [document paths](../packages/db-conformance/src/suites/document-paths.ts).

## Lock-order refinement for R3a

The initial Task 6 guard took an exclusive collection registration lock before every document lock. This prevented the collection/document inversion caused by version/path/audit foreign-key inserts, but serialized independent flat-document writes. R3a-1 requested a narrower policy, which the user approved on 2026-09-05.

Ordinary flat-document mutations now acquire a shared registration lock: PostgreSQL `FOR KEY SHARE`, MySQL `FOR SHARE`. Deletion, media replacement, PostgreSQL re-anchor maintenance, tree collections, and singleton coordination retain exclusive `FOR UPDATE` locks. The lifecycle guard chooses the mode before any document lock; it never upgrades a shared registration lock after locking a document. Raw soft-delete/un-delete and structural commands retain their existing exclusive collection-first discipline.

Both providers expose `commands.collections.lockCollectionRegistration(collectionId, mode)`. The singleton-specific `lockSlot` delegates to the same primitive with exclusive mode. Invalid modes, missing registrations, and missing ambient transactions receive explicit errors with collection terminology. This addresses R3a-2 without turning the singleton API into a generic locking API.

R3a-3 has a real-adapter regression: save A pauses after acquiring its collection and document locks; save B targets a different document in the same collection and must commit before A is released. A timeout or early settlement of A fails the test. Cleanup releases A and drains both promises even on failure. Nine operation-level assertions check collection mode and collection-before-document order; a separate media assertion checks exclusive-before-document order. The existing save/delete contention and singleton-first-save race cases remain active.

Preparation hooks and ordinary/cacheable reads remain outside the final mutation lock interval. Task 7 still owns worker lock ordering and structural/derived revision integration; this checkpoint does not claim those races are solved.

## T5-1 resolution

The webapp and CLI `regenerate-media-operation.ts` modules now re-export the actual guarded core operation. There is no pass-through adapter double and no unchecked adapter cast in the dedicated webapp test. The four former pending behaviors moved into executable shared integration cases run against both providers. The webapp suite retains three pure-helper cases, checks that its operation is the exact core entry point covered by integration, and adds two cleanup cases. Both callers preserve newly referenced files after a committed after-hook failure; only rejected writes discard fresh paths. A real-adapter afterUpdate failure confirms that the core emits the committed receipt consumed by the cleanup helper. This replaces the old mock-only approach rather than rebuilding a double that could conceal transaction ownership again.

Both `regenerate-media.ts` callers capture editable all-locale fields and their revision before image processing and pass that observation into the replacement. Both re-anchor scripts capture an explicit batch of document IDs and revisions before any writes. The two media-operation modules are identical. Task 10 still owns the wider copied-template equivalence and packaging audit.

## Original Task 6 verification

| Command | Result |
| --- | --- |
| `pnpm build:packages` | 21 tasks passed |
| `pnpm --filter @byline/db-postgres test:integration` | 352 tests / 8 files passed; no skips |
| `pnpm --filter @byline/db-mysql test:integration` | 373 tests / 11 files passed; no skips |
| `pnpm --filter @byline/client test:integration` | 168 tests / 19 files passed; no skips |
| `pnpm --filter @byline/core test` | 1,106 tests / 60 files passed |
| `pnpm --filter @byline/client test` | 128 tests / 12 files passed |
| `pnpm --filter @byline/host-tanstack-start test` | 33 jsdom tests / 6 files; 157 node tests / 25 files passed |
| `pnpm --filter @byline/db-postgres test` | 46 tests / 6 files passed |
| `pnpm --filter @byline/db-mysql test` | 324 tests / 5 files passed |
| Webapp media-operation node test | 6 passed; no todos or skips |
| `pnpm typecheck` | All 44 Turbo tasks passed |
| `pnpm knip` / `pnpm knip:exports` | Passed; 1,216 reviewed baseline entries |
| `pnpm --filter @byline/cli check:templates` | Four dialect/config template typechecks passed |

Scoped Biome and `git diff --check` passed. One now-consumed public-export baseline entry was pruned; no unconsumed public API was added. The existing sandbox-compatible `node --import tsx` invocations of the documentation and generation scripts passed: **69 documents / 692 links**, and **six collections / fingerprint `1350833324d2` / current**. These are script-equivalent checks, not claims that sandbox-blocked `tsx` wrappers ran successfully. Local review-document links were checked against the filesystem.

 Integration runs consume built package exports; package builds must finish before the regression runs. PostgreSQL provider and SDK tests share one database and run serially. MySQL uses its separate test database. No filtered diagnostic run is counted as a complete integration pass.

Initial runs exposed obsolete caller inputs, sequential fixtures still using revision 1, old result shapes, obsolete externally-owned-transaction expectations, and missing committed-hook receipts. These were repaired without weakening guards. The full provider rerun also caught a stale built core export while a build overlapped a diagnostic run: the flat-delete ordering assertion failed rather than giving misleading passing evidence. Subsequent regression runs use a completed package build. A scoped Biome unsafe fix changed two test fixture non-null assertions into optional access; explicit fixture validation restored their type safety.

## R3a follow-up verification — 2026-09-05

The narrower lock policy and R3a-2/R3a-3 follow-ups are implemented for final review. All commands below completed successfully; integration runs had no skips.

| Check | Result |
| --- | --- |
| Package build | 21 tasks passed |
| PostgreSQL full integration | 357 tests / 8 files passed |
| MySQL full integration | 378 tests / 11 files passed |
| SDK full integration | 168 tests / 19 files passed; run after PostgreSQL completed |
| Core and client unit suites | 1,106 / 60 files and 128 / 12 files passed |
| Host unit suites | 33 jsdom / 6 files and 157 node / 25 files passed |
| Provider unit suites | PostgreSQL 46 / 6 files; MySQL 324 / 5 files passed |
| Dedicated media-operation suite | 6 / 1 file passed, no pending cases |
| Root typecheck | 44 tasks passed |
| Knip and public exports | Passed; existing 1,216-entry baseline unchanged by this follow-up |
| CLI template checks | All four dialect/config typechecks passed |
| Documentation and generated types | 69 documents / 692 links; six collections / fingerprint `1350833324d2`, current |

The five additional integration cases per provider cover two registration lock modes, invalid-mode rejection, independent document commits, and exclusive media lock ordering. Existing singleton mapping checks now expect the deliberately generalized collection-lock error. The initial full runs failed that obsolete exact-message assertion on each provider; both complete suites passed after correcting it. Initial build/unit failures exposed missing new command members in test doubles; those were repaired explicitly, without introducing adapter casts. These diagnostics are not counted as passing runs. R2-1's broader unchecked-cast audit remains assigned to Task 8.

The documentation/generation checks use the previously documented sandbox-compatible `node --import tsx` invocation. Scoped Biome, local review-document links and `git diff --check` passed. Logs are under `/tmp/byline-r3a-*.log`. No migration SQL, migration ledger, squash, release or deployment change is part of this follow-up.

## R3a handoff and remaining boundaries

The reviewing agent should inspect Tasks 5 and 6 together: one advance per changed document, combined path-conflict precedence, stale publish/duplicate races, real maintenance entry points and rollback, and hooks outside final mutation locks. The R3a reviewer explicitly closed T5-1 after inspecting the operation and real-adapter coverage together.

R1-1 (upgrade-specific suspension reason) remains Task 7; R2-1 (adapter-double and unchecked-cast audit across excluded and root-typechecked tests) remains Task 8/R4. Task 7 also owns schedule arm/reconfirm/worker revisions, structural target/derived revisions, automatic root placement/self-heal, and safe structural suspension summaries. This checkpoint is not a complete release-level concurrency guarantee. The R3a checkbox is marked passed on the basis of the independent reviewer verdict, not an implementer self-review.

The direct first-party writer audit found creation-only raw seed writes in webapp docs/news-category/FAQ fixtures and copied CLI docs/news-category seeds. Existing-document import now uses guarded SDK writes; media and re-anchor maintenance are converted here. Raw storage primitives and test setup remain internal capabilities, not a supported editor/SDK bypass.

No migration SQL, development migration ledgers, Drizzle squash, CLI baseline migration replacement, production cutover, deployment, or commit is performed by Task 6. The existing integration migration suites operate only on test databases. The user's numbered downstream SQL and squashed development/CLI migration workflow remains assigned to Task 10.

## R3a-4 follow-up — deterministic storage contention

The reviewer reproduced two failures in nine MySQL runs of the raw existing-document write versus soft-delete test. The earlier full green run was accurate but insufficient evidence for an uncoordinated race. The test assumed deletion would win even though either transaction could lose a database deadlock. The guarded public lifecycle lock design is unchanged by this correction.

The replacement test, `rejects an existing-document write after a concurrent soft delete acquires its locks`, orders deletion first and holds its collection/document locks in an outer transaction. A barrier starts the writer only after deletion has performed its storage work; the physical-connection observer keeps deletion open until a second connection is checked out. Both operations are drained. The assertions require a successful deletion and the specific typed deleted-document conflict from the writer, unchanged one-entry history, an absent live path, and successful path reuse. Arbitrary rejection, deadlock victim selection, or a timeout cannot satisfy the assertions.

Ten consecutive runs **per provider** of the selected path, guarded lifecycle, and revision primitive suites passed: **114 passed / 195 filtered out per run**, or 1,140 executed cases per provider. These are focused repeat runs, not full-suite passes. The exact command is `pnpm --filter @byline/db-<provider> exec vitest run --mode=integration tests/conformance.integration.test.ts -t 'byline_document_paths integration|guarded lifecycle saves|document revision primitives'`, repeated serially ten times within each provider. Logs are `/tmp/byline-r3a4-postgres-1.log` through `-10.log` and the equivalent MySQL paths. The conformance package typecheck and scoped Biome also pass.

R3a-4(b) is deliberately deferred: Task 7/R3b owns typed deadlock/serialization/lock-wait classification, whole-transaction rollback, and SDK/host propagation; Task 9/R4 owns the safe editor message. This is a distinct lock-conflict error, not proof of a stale revision. Explicit retry eligibility requires confirmed rollback; unknown commit outcomes must retain their uncertainty. There is no automatic retry or revision refresh. The [plan](./2026-09-05-stale-document-write-protection-plan.md) records both assignments and the ten-repeat requirement for later concurrency checkpoints. No production error-handling change is claimed here.

After the repeat runs, both complete provider integration suites passed again without skips: **PostgreSQL 357 / 8 files; MySQL 378 / 11 files**. Full logs are `/tmp/byline-r3a4-postgres-full.log` and `/tmp/byline-r3a4-mysql-full.log`. Documentation checks passed at 69 documents / 692 links; local review links and `git diff --check` passed. SDK, root typecheck and Knip results above belong to the earlier follow-up and were not rerun for this test/documentation-only correction. The reviewer subsequently verified this correction and passed R3a; the implementation plan records that verdict and the reviewer’s additional full-suite repeats.
