---
title: "Stale document write protection Task 7 evidence"
path: "stale-document-write-protection-task7"
summary: "Implementation and verification evidence for revision-guarded schedules, workers, structural mutations, and confirmed lock failures at R3b."
---

# Stale document write protection Task 7 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines the coverage ledger and R3b gate.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the release contract.
- [Task 6 evidence](./2026-09-05-stale-document-write-protection-task6.md) records the preceding R3a implementation.

Task 7 passed independent R3b review on 2026-09-05 with no blocking findings. The implementation plan records the independent verdict; this document preserves implementation evidence and does not claim release authorization.

## Implementation and coverage

| Ledger IDs / area | Implementation | Executable evidence |
| --- | --- | --- |
| P01 / schedule authorization | Arm, reschedule and reconfirm require the observed revision and content target. Their transaction stores the resulting revision in `authorized_revision`, audits it, and advances once. Cancellation returns a nullable schedule plus a receipt; a current empty cancellation does not advance. A mismatched content target is typed stale state. | Shared `scheduled-structural-revisions.ts`: arm/reconfirm/cancel sequence, stale cancellation, metadata suspension, cancellation rollback. Existing shared schedule-store cases and SDK scheduled-publication integration remain active. |
| P01 / worker publication | Lease acquisition ends before editorial work. Final publication acquires collection registration, document, then schedule locks. The worker checks armed state, execution token, lease, authorized revision, current content and workflow. Status, audit, schedule removal and one revision advance commit together. Hooks run outside the final transaction. Final removal also checks lease validity; PostgreSQL uses wall-clock time rather than transaction-start time for that fence. | Three barrier cases each for editor-first preparation and worker-first final locks: save, status and delete. Worker-first cases assert two physical connections, one publication, typed stale editor failure, and revision 3. Additional authorization-mismatch, replaced-claim and successful-publication cases; existing store coverage rejects an expired claim before replacement. |
| P01 / mismatch finalization | Still-owned mismatches suspend under the same collection/document/schedule order and advance once. The old authorization remains recorded; no latest-revision authorization is substituted. Operational claim/release/backoff does not advance document revisions. | Authorization mismatch retains authorized revision 2 while suspension advances current revision 3 to 4. Replaced-claim case leaves the replacement token, state and revision untouched. |
| T01 / tree and derived targets | Exclusive collection coordination precedes structural discovery and sorted document locks. Tree operations lock the explicit target and its possible promoted children; flat reorder locks the collection's live documents. Existing schedules are locked in stable order after documents. Stored placement/key changes determine derived advances, so displayed sibling-index shifts do not cause revision churn. | Promotion advances the changed child and suspends its schedule while an unchanged root remains at revision 1. Coordinated opposite-direction moves and same-document moves enforce the final state and inspect connection contention. Stale no-op and failed-derived-compare cases make no changes. |
| T01 / reorder and repair | Flat reorder now has a core lifecycle service. Neighbor validation, missing/duplicate-key repair, key writes, audit, schedule suspension and receipts share the guarded transaction. Only keys that actually change advance their documents. | Corrupt-key case verifies both changed documents advance once and the sibling schedule requires reconfirmation. Existing path/saves/tree regressions also run at this checkpoint. |
| T01 / transactional placement | Initial creation includes automatic root placement and its audit at revision 1. Update self-heal runs inside the initiating save transaction. Placement failure rolls back the content write instead of leaving a successful partial save. Existing create/update hooks cover automatic-placement invalidation. | Initial-placement audit failure leaves no created document. Self-heal audit failure preserves the previous content version, unplaced state and revision. Late second-target failure restores deletion, child placement, schedules and earlier revision increments. |
| T01, U01 / authorization and receipts | Structural/delete results return changed document receipts and a separate `scheduledPublicationsNeedReconfirmation` boolean. Schedule visibility requires publish and change-status abilities; derived receipts require read ability. Post-commit hook errors retain their committed receipt. Unavailable legacy structural targets fail closed if a raw primitive attempts to change a target that could not be revision-locked. | Real `AdminAuth` write-only deletion test returns only the explicit target receipt and no schedule summary while verifying the child's revision/suspension internally. Existing committed-hook and delete-side-effect suites remain active. |
| R3a-4(b) / provider classification | PostgreSQL deadlock, serialization and lock-timeout codes and MySQL deadlock/lock-timeout codes classify as lock conflicts. The owned transaction boundary emits `ERR_LOCK_CONFLICT` only after Drizzle successfully rolls back the entire transaction and rethrows the same callback failure. Nested savepoint failures, rollback failure, connection loss and uncertain commit failures are not independently represented as safely retryable. Classification requires a recognized failure reaching the owned boundary; an error replaced during rollback cleanup remains unclassified. No write is automatically retried. | Provider classification units and transaction ownership/outcome units; real two-connection timeout on both engines first changes another document's key and revision, then verifies both changes rolled back. This includes MySQL statement-only timeout behavior. |
| R3a-4(b), H01 / propagation | The error keeps its cause for server diagnostics, uses a fixed public message and allows only `{ reason: 'lock_conflict', rolledBack: true, retryable: true }` through the decoder. A private message marker survives message-only Error reconstruction. | SDK integration verifies identity propagation and one lock attempt, with unchanged revision. Host singleton handler verifies propagation and message reconstruction. Core tests cover live errors, JSON reports, message-only errors, malformed contracts, and omission of driver SQL from public reports. Local TanStack `ShallowErrorPlugin` source was inspected: it reconstructs Errors from `message` only. This is not a browser/E2E transport test; the broader actual serialization matrix remains Task 8. |
| R1-1, M01 / upgrade reason | `upgrade_invalidated` is separate from content and metadata edits. Native upgrade scripts suspend legacy armed schedules with this reason and relabel the earlier development upgrade's unauthorised metadata suspension. Both providers require the widened check at startup. | Both migration integration suites run occupied-data native and incremental-chain upgrades, fresh schema construction, repeat execution and invalid-schema rejection. MySQL native interruption/resume cases remain active. |
| A01, H01, R01 / callers | SDK and host schedule/tree methods require caller observations and return committed receipts. Schedule action lists assemble document revision and schedule in one snapshot. Admin mutation callers forward loaded revisions. Import scripts carry the revision returned by content import into the later placement; SDK fixture setup uses explicit editable reads for each independent test action. | Root typechecking, SDK integration, client/host units and shared conformance. Template equivalence/compilation and the general adapter-double audit remain their named later checkpoints. |

The new shared suite contains **21 executable cases per provider**, including parameterized race cases. The existing `document-tree lifecycle audit atomicity` same-document race was also converted to explicit lock barriers. Bounded barriers and drained promises prevent a timeout or arbitrary rejection from counting as a legitimate losing writer.

## Migration artifacts and operation boundaries

Drizzle generated `0002_tiny_callisto.sql` for PostgreSQL and `0002_gifted_galactus.sql` for MySQL, together with their journal/snapshot entries. The SQL was then completed with the data transition; MySQL constraint widening uses inspected, re-runnable stages to tolerate its implicit DDL commits. The already-applied `0001` migrations and snapshots were not rewritten.

The unreleased downstream scripts remain `packages/db-postgres/sql/0010_document-revisions.sql` and `packages/db-mysql/sql/0005_document-revisions.sql`. They express the final upgrade directly; migration tests now verify the native script and incremental chain against the same occupied-data assertions instead of requiring byte equality with one incremental file. The native SQL history check against `HEAD` confirms all **13 previously committed scripts** are unchanged. Comparing against the actual previous release remains an operator/release gate.

This task applied the new migration only through local test database setup. It did not run it against development or production, reconcile development ledgers, squash Drizzle history, replace the CLI baseline, publish packages, or perform a cutover. The user-specified squash/CLI workflow remains Task 10.

## Verification

The following checks completed successfully except for the explicitly failed supplemental SDK test-tree typecheck.

| Check | Result |
| --- | --- |
| PostgreSQL full integration | 378 tests / 8 files passed |
| MySQL full integration | 399 tests / 11 files passed |
| SDK full integration | 169 tests / 19 files passed, no skips |
| Core units | 1,109 passed |
| Client units | 128 passed |
| Provider units | PostgreSQL 54; MySQL 331 passed |
| Host units | 33 jsdom and 158 node passed |
| Root `pnpm typecheck` | 44 tasks passed |
| Knip / public export audit | Passed; 1,216 baseline entries. Fractional-key generation remains deliberate public API after its host consumer moved into core; the lock marker is private. |
| Generated types | Current: 6 collections, hash `1350833324d2` |
| Documentation | 69 documents / 692 links passed; evidence/plan relative links are checked separately |
| Native SQL history | Passed against `HEAD`: 13 committed scripts unchanged |
| Supplemental SDK test-tree typecheck | **Not passed: 103 diagnostics**; R2-1 / Task 8 remains open |
| PostgreSQL concurrency repetitions | 10/10 consecutive runs passed; 134 selected tests each |
| MySQL concurrency repetitions | 10/10 consecutive runs passed; 134 selected tests each |

Each repeat selects `Task 7 scheduled and structural revisions`, `guarded lifecycle saves`, `byline_document_paths integration`, `document-tree lifecycle audit atomicity`, and `document publish schedules` from the provider's conformance entry point. There are **134 selected tests per run**; the other 196 conformance tests are intentionally excluded by the filter. Each run has a 120-second process bound and stops the series on failure. Full provider runs supply the unfiltered regression evidence. Repetition supplements deterministic coordination; it does not prove absence of races.

Checks ran locally with Node **24.18.0** and pnpm **11.17.0**; CI uses Node 22 and was not run in this task.

Commands use the package manifests: provider/SDK `test:integration`, package `test`, root `typecheck`, `knip`, `knip:exports`, and `check:native-sql-history --base HEAD`. Documentation and generation checks use the established `node --import tsx` script invocations from `apps/webapp`, avoiding the sandbox's blocked tsx IPC launcher. No blocked attempt, timeout, filtered-out case, or supplemental typecheck is counted as passing evidence.

The SDK supplemental diagnostics include incomplete adapter doubles, legacy search fixture declarations, missing `pg` test types, narrowed selection assertions, and optional revision/ID fixture typing. This run identifies current unresolved diagnostics; it does not claim to have completed Task 8's cast audit or to have proven every diagnostic predates Task 7.

## Review focus and carried work

R3b passed review of worker and structural lock order, derived-target discovery, stored-change comparison, lease and authorization fences, atomic placement/rollback, confirmed-rollback error classification, SDK/host propagation and the permission-limited suspension summary. The reviewer independently reproduced PostgreSQL 378, MySQL 399, SDK 169, typecheck 44, knip clean, exports 1,216 and native SQL history 13 unchanged. The reviewer also ran ten full-suite repetitions per provider (20/20 clean), separately from the selected concurrency repetitions recorded above. R1-1 is closed; the semantic occupied-fixture comparison of native and incremental upgrades was explicitly accepted.

Task 8 still owns the broader adapter-double/cast repair, SDK type-contract matrix, raw JavaScript/old-client payload matrix, and actual server-function serialization coverage. Task 9 owns persistent stale state, safe lock-conflict presentation, structural schedule notices, and editor adoption/reload of receipts (including an immediate tree-placement action in an open form). This task supplies those receipts and summary data; it does not claim the editor recovery workflow is complete. Task 10 retains copied-template equivalence, migration squashing and operator verification. R3b is passed; R4 and R5 remain unchecked.

Diagnostic runs before the final checks found outdated receipt/precondition expectations and a wrong reorder fixture assumption. The SDK fixture correction uses `findByIdForEdit`; ordinary reads correctly remain token-free. An early failed expired-claim assertion stranded an older schedule test behind its barrier; both provider processes were stopped with exit 130 and counted as failed diagnostic runs. The final full runs and both ten-run repeat sets completed normally. After tightening failure-path draining in two worker tests, both ten-run repeat sets were run again and passed. The earlier usage-limit approval rejections did not execute tests and provide no test evidence.
