---
title: "Stale document write protection Task 5 evidence"
path: "stale-document-write-protection-task5"
summary: "Implementation and verification evidence for atomic revision-guarded content, metadata, singleton, and upload saves."
---

# Stale document write protection Task 5 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines Task 5 and the joint Tasks 5–6 R3a review gate.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the complete release contract.
- [R0 decisions](./2026-09-05-stale-document-write-protection-r0.md) define transaction ownership and maintenance replacement requirements.
- [R2 evidence](./2026-09-05-stale-document-write-protection-r2.md) covers coherent editable observations.

Task 5 is implemented. This is implementation evidence, not an R3a review verdict or release approval. Task 6 remains pending. The earlier R0, R1, and R2 review records are preserved.

## Implemented behavior

| Area / ledger IDs | Implementation | Evidence |
| --- | --- | --- |
| Full replacement, patches, combined Save / L01, D01 | [Private revision boundary](../packages/core/src/services/document-lifecycle/revision-guard.ts), [save operations](../packages/core/src/services/document-lifecycle/update.ts) | Authorize, reject external transaction ownership and malformed observations, read a coherent preflight, prepare outside locks, then compare the caller's revision and parent under the document lock. All final writes use the existing audit transaction and adapter savepoints. Advance once after successful writes. No retry or unconditional-write option exists. |
| Metadata / L01, L02 | [System fields](../packages/core/src/services/document-lifecycle/system-fields.ts) | Path validation/write and metadata audit precede content insertion inside combined Save. Standalone changes advance once; current no-ops do not advance, and stale no-ops fail. Source-locale restrictions and sticky values remain. |
| Save-side schedule effects / L01, P01 | [Schedule consistency](../packages/core/src/services/document-lifecycle/publish-schedule-consistency.ts), both providers' `publish-schedules.ts` | Content saves suspend with `content_edited`; metadata-only changes use `document_metadata_changed`. Schedule changes and audit roll back with the document and revision. Nested helpers do not advance revisions. |
| Singleton saves / S01 | [Singleton update](../packages/core/src/services/singleton-lifecycle/update.ts) | Explicit empty-slot expectation or observed revision is required. Preparation hooks run outside the final transaction. Final lock order is slot → document → schedule. Only one competing first save commits; the loser receives `singleton_slot_changed`. Existing saves advance once. |
| Creation and uploads / L01, H01 | [Create](../packages/core/src/services/document-lifecycle/create.ts), [field upload](../packages/core/src/services/field-upload.ts) | Creation and upload-to-new-document return revision 1. Deferred upload only prepares a file; attaching it requires a guarded save. A committed creation hook failure preserves the stored files and propagates the committed receipt instead of deleting files referenced by committed content. |
| Hooks and receipts / L01, H01 | [Committed-hook classification](../packages/core/src/services/document-lifecycle/committed-hook.ts), [host response](../packages/host-tanstack-start/src/server-fns/collections/save-outcome.ts) | Already-stale requests fail before hooks/counters/embed preparation. Final comparison catches a winner during preparation without replay. Metadata after-hooks precede content after-hooks, outside final locks. Converted operations include the committed revision in hook-failure details; lazy metadata-hook resolution is inside that classification boundary. |
| SDK/admin callers / A01, H01 | [Collection handle](../packages/client/src/collection-handle.ts), [singleton handle](../packages/client/src/singleton-handle.ts), [host Save](../packages/host-tanstack-start/src/server-fns/collections/update.ts), [editor](../packages/host-tanstack-start/src/admin-shell/collections/edit.tsx) | Required SDK expectations, one admin request for content plus metadata, loaded revision forwarded unchanged, explicit singleton empty state, and upload receipt typing. Successful saves refresh through the existing loader. Sticky stale-warning behavior remains Task 9. |
| First-party scripts | [Importer](../apps/webapp/byline/scripts/import-docs.ts), [singleton seed](../apps/webapp/byline/seeds/site-settings.ts), webapp and copied CLI media scripts | Importer loads a coherent editable target before using its fields and revision. Singleton seed uses an explicit empty observation. Media scripts capture and forward revisions before processing; their approved transaction/status replacement still belongs to Task 6 and must land before R3a. |
| R2-2 | [Snapshot conformance](../packages/db-conformance/src/suites/editable-snapshots.ts) | Exact sorted document-facade keys, in addition to exact nested schedule keys, pass on both providers. R2-2 is closed by this follow-up. |

## Test evidence

[Shared guarded-save conformance](../packages/db-conformance/src/suites/guarded-saves.ts) adds **21 cases per engine**. It covers creation/combined receipts, actual live-path collision before insertion, metadata committed-hook failure, rollback at path/content/audit/schedule/revision stages, metadata suspension and stale no-ops, controlled competing replacements, rejection before preparation, committed content-hook failure, eight malformed/missing observations, and external transaction rejection.

The replacement race holds one editor in its preparation hook, commits the competing editor, then releases the loser. Barriers have a failure timeout; no sleep or automatic retry establishes the ordering. [Singleton conformance](../packages/db-conformance/src/suites/singleton-lifecycle.ts) holds the actual slot lock and observes two physical connections. The test requires one creation receipt and one stale-slot error. Its real image-upload case also rejects a stale attachment and preserves the winning file. Rollback tests compare content, metadata, audit, schedule, and revision, and assert after-hooks did not run.

[SDK integration](../packages/client/tests/integration/client-write.integration.test.ts) tests stale replacement from an editable snapshot and omitted revision through a JavaScript call. [Host Save tests](../packages/host-tanstack-start/src/admin-shell/collections/save-navigation.test.tsx) require a single combined request carrying the loaded revision. [Core upload tests](../packages/core/src/services/field-upload.test.node.ts) distinguish genuine creation rollback from committed after-hook failure. Core lifecycle tests pin metadata/content hook order and verify hooks execute outside the transaction.

| Command | Final result |
| --- | --- |
| `pnpm --filter @byline/db-postgres test:integration` | 297 tests / 8 files passed; no skips |
| `pnpm --filter @byline/db-mysql test:integration` | 322 tests / 11 files passed; no skips |
| `pnpm --filter @byline/client test:integration` | 168 tests / 19 files passed; no skips |
| `pnpm --filter @byline/core test` | 1,106 tests / 60 files passed |
| `pnpm --filter @byline/client test` | 128 tests / 12 files passed |
| `pnpm --filter @byline/host-tanstack-start test` | 33 jsdom tests / 6 files and 157 node tests / 25 files passed |
| `pnpm typecheck` | All 44 Turbo tasks passed |
| `pnpm knip` | Passed |
| `pnpm knip:exports` | Passed with 1,217 known entries |

Focused Biome formatting/checks passed for changed source/test files. The public-export baseline retains the deliberate patch API/result and standalone metadata host API, now unused by the combined admin save, and the new singleton save result type. Entries now consumed by implementation are pruned from the unconsumed set.

Initial runs failed on old caller arguments, mock capabilities, and test expectations; those failures were fixed and rerun. Filtered diagnostic runs are not counted as full integration passes. PostgreSQL provider and SDK suites ran serially against their shared test database. MySQL ran against its separate test database. The root `pnpm byline:generate:check` wrapper failed at the sandbox's `tsx` IPC pipe (`listen EPERM`). Running the same script as `node --import tsx byline/scripts/generate-types.ts --check` from the webapp passed: six collections, fingerprint `1350833324d2`, current. The corresponding sandbox-compatible documentation invocation, `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'`, passed 69 documents / 692 links. These substitutions are recorded as such, not as successful wrapper executions. An additional diagnostic run extending the publishing checker to all six work specifications failed on 62 relative source-code links: these local review documents are not published documentation. Local link targets in the changed plan/evidence were checked directly and all resolved.

## Carried boundaries for Tasks 6–9

- R3a remains pending Task 6 and independent review. Status, deletion, restore/copy, duplicate, maintenance, and singleton variants still require conversion. The worker and schedule authorization are Task 7. This intermediate work is not a releasable global stale-write guarantee.
- Automatic tree root placement/self-heal still uses the existing post-save behavior. Task 7 must move it into the initiating structural transaction with collection-first lock order and appropriate derived revisions.
- The old media-regeneration outer transaction is intentionally rejected by the new lifecycle ownership check. Task 6 must replace it with the approved status-preserving guarded operation, retain published-version archival, and deliberately remove the false status-change audit. No compatibility bypass was introduced to keep that composition running.
- Committed-hook revision typing remains optional in the common envelope while unconverted Task 6 operations still use it. Every converted Task 5 operation supplies its receipt. Task 6 must complete the remaining producers.
- R1-1's upgrade-specific suspension reason remains open. R2-1's supplemental client test-tree mock repair remains assigned to Task 8/R4; relevant executable save mocks were updated here, but no full supplemental test-tree typecheck pass is claimed.
- No new migration files, development ledger edits, Drizzle squash, CLI baseline replacement, deployment, or commit occurred in Task 5. Integration suites exercised their existing test-database migration fixtures.


## T5-1 correction after the mid-task review

The dedicated media-operation test's earlier 7/7 result did not exercise the real lifecycle or adapter transaction ownership. Its pass-through harness and unchecked casts masked the known runtime failure. That result must not be used as evidence that regeneration works or that Task 6 is complete.

The misleading harness has been removed. Three pure-helper tests remain executable; four operation scenarios are explicitly pending Task 6 / T5-1. T5-1 stays open until the guarded replacement and contract-checked tests land together with real-adapter integration coverage. The reviewer independently confirmed PostgreSQL's 297 tests in this round; other gate results above remain implementer-reported, not newly reviewer-verified. This follow-up is not an R3a pass.

## Task 6 follow-up

The [Task 6 evidence](./2026-09-05-stale-document-write-protection-task6.md) supersedes the pending implementation boundaries above for lifecycle, maintenance and required committed-hook receipts. It records the T5-1 replacement and real-adapter coverage together. The earlier Task 5 and correction records remain historical; neither is an independent R3a verdict.
