---
title: "Stale document write protection implementation plan"
path: "stale-document-write-protection-plan"
summary: "Sequence document revision enforcement, SDK and admin integration, and rollout work through explicit review checkpoints."
---

# Stale document write protection implementation plan

Companions:

- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the behavioral contract and accepted tradeoffs.
- [Transactions](../docs/03-architecture/03-transactions.md) describes ambient transactions and external side-effect limits.
- [Document storage](../docs/03-architecture/01-document-storage.md) explains document identity, versions, and metadata.
- [Testing](../docs/13-testing.md) describes database and browser test setup.

Date: 2026-09-05

Status: implementation started with user authorization on 2026-09-05. R0 and R1 passed. Tasks 2–4 are implemented and reviewed; R2 passed. Tasks 5–6 are implemented and verified; R3a requested the narrower collection-lock policy, which the user approved and the reviewer has accepted. R3a passed independent review on 2026-09-05; R3a-4(a) is closed. Task 7 passed independent R3b review on 2026-09-05, including ten full-suite repetitions per provider (20/20 clean). R2-2 is closed by the Task 5 follow-up. R1-1 is closed by R3b; R2-1 remains open for Task 8/R4, including the supplemental test-tree diagnostics recorded in Task 7 evidence. T5-1 is closed by the R3a reviewer. This document does not authorize release/deployment.

Plan review revision: split single-document and scheduler/structural review gates, define a bounded editable-read fallback, require resumable MySQL upgrade stages, and reserve the coverage ledger below. These changes do not mark any implementation task complete.

## Outcome and working rules

Implement the approved document-wide revision contract across PostgreSQL, MySQL, core lifecycle services, the SDK, and Byline's admin interface. Every supported existing-document mutation must reject an outdated observed revision without committing part of the requested change. Editors receive a specific warning and an explicit reload/discard action.

Work through the tasks in dependency order. At each checkpoint, prepare the evidence described below and hand it to the reviewing agent. Do not advance past a checkpoint until its blocking findings are resolved and the reviewer records a pass. A pass approves that implementation stage, not deployment. If the reviewer identifies a necessary change to the approved behavior, return that decision to the user before implementing the deviation.

Keep task checkboxes and checkpoint outcomes current. Record exact commands, test counts, commit IDs or diff references, and any unrun checks. A missing database or browser environment is an explicit outstanding gate, never a passing result. No new agent sessions are created by writing this plan.

This is one coordinated breaking release. Foundation stages are reviewable development states, not independently releasable packages. Do not publish, merge for release, or deploy a partially converted writer graph. Use private helpers while building foundations; when changing a required public signature, update its implementations, first-party callers, and test fixtures together. Never introduce a temporary public unconditional-write flag or fill missing revisions inside a mutation to make compilation pass.

## Task and checkpoint map

| Tasks | Deliverable | Depends on | Review checkpoint |
| --- | --- | --- | --- |
| 1 | Mutation inventory, signatures, snapshot and lock design | Approved spec | R0: design readiness |
| 2–3 | Typed errors, schema, migrations, provider primitives | R0 | R1: storage foundation |
| 4 | Coherent editable reads | R1 | R2: read integrity |
| 5–6 | Atomic saves and single-document lifecycle/maintenance mutations | R2 | R3a: single-document enforcement |
| 7 | Scheduler execution, multi-document and structural effects | R3a | R3b: scheduler and structural enforcement |
| 8–9 | Required SDK/host preconditions and admin recovery | R3b | R4: end-to-end behavior |
| 10–11 | Upgrade documentation, templates, release evidence and full regression | R4 | R5: release readiness |

Tasks 5–9 form the coordinated public API conversion. If a signature change in Tasks 5–7 requires SDK or host payload changes, bring forward those mechanical portions of Task 8 in the same change. Keep Task 8's independent omission/security/transport audit; compilation alone is not proof of enforcement. Do not defer broken callers to a later checkpoint.

## Coverage ledger

Task 1 inventory, recorded on 2026-09-05. The [R0 contract note](./2026-09-05-stale-document-write-protection-r0.md) defines the proposed signatures, executor strategy, lock ordering, and test IDs. The operation rows track end-to-end coverage. C01, D01 primitives, and the migration/startup portion of M01 now have executed foundation evidence in the [R1 handoff](./2026-09-05-stale-document-write-protection-r1.md); Task 5 save-related destinations now have executed evidence in the [Task 5 note](./2026-09-05-stale-document-write-protection-task5.md); Task 6 lifecycle and maintenance destinations have executed evidence in the [Task 6 note](./2026-09-05-stale-document-write-protection-task6.md); remaining destinations stay assigned to their later checkpoints. Paths use core operation names and host file names under `packages/host-tanstack-start/src/server-fns/`; SDK method names refer to collection/singleton handles.

Lock abbreviations: **C** = collection structural row; **S** = singleton slot; **D** = sorted document rows; **P** = sorted publication schedule rows. Acquire only the needed classes, in that order. **Receipt** means the operation's existing result plus its committed revision; **stale** means the dedicated typed error. End-to-end lifecycle enforcement in these rows remains pending later checkpoints; completed storage foundations do not mark an operation fully protected.

| Operation and target kind | Observed revision source | Entry points | Owning transaction | Lock set/order | Revision advances | Schedule effects | Result/error contract | Tests and evidence | Task/checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary document create | No existing target | SDK `create`; host `collections/create.ts`; core `createDocument` | Initial create coordinator | C if ordered/tree; new D | New document = 1 | None | Version + receipt | D01, L01, A01 | 5 / R3a; placement 7 / R3b |
| Content full replacement | `findByIdForEdit` | SDK `update`; core `updateDocument` | Guarded save | D → P; C first if tree self-heal | Target +1 | Suspend armed | Version + receipt / stale | L01, A01, D01 | 5 / R3a |
| Patches | Loaded editable document | Host `collections/update.ts`; core `updateDocumentWithPatches` | Guarded save | D → P; C first if tree self-heal | Target +1 | Suspend armed | Version + receipt / stale | L01, H01, U01 | 5 / R3a |
| Content plus path/locales | Same loaded snapshot | Host `collections/update.ts`; new core `saveDocument` | One combined save | D → P; C first if tree self-heal | Target +1 once | Suspend armed once | Version + receipt / stale; no partial save | L01, D01, H01 | 5 / R3a |
| Path/advertised locales only | Loaded editable metadata | Host `collections/update.ts`; core `updateDocumentSystemFields` | Guarded metadata mutation | C → D → P | Target +1 if changed | Suspend armed | Receipt / stale even for stale no-op | L01, L02, H01 | 5 / R3a |
| Status / unpublish | Current-edit snapshot | SDK `changeStatus`/`unpublish`; host collection status and singleton actions; core `changeDocumentStatus`/`unpublishDocument` | Guarded transition | C/S → D → P | Target +1 if changed | Cancel existing | Transition + receipt / stale | L02, P01, U01 | 6 / R3a |
| Arm/reschedule/reconfirm | Current-edit snapshot + target version | SDK schedule methods; host `collections/scheduled-publication.ts` and singleton schedule files; core schedule/confirm | Guarded schedule mutation | C/S → D → P | Target +1 | Store resulting authorized revision | Schedule + receipt / stale | P01, A01, H01 | 7 / R3b |
| Cancel publication | Current-edit snapshot | SDK cancel; host collection/singleton cancel; core `cancelDocumentScheduledPublish` | Guarded cancellation | C/S → D → P | Target +1 if removed | Remove schedule | Nullable schedule + receipt / stale | P01, H01 | 7 / R3b |
| Worker publication | Persisted authorized revision + claim | Core `publishClaimedScheduledDocument`; provider `lockClaim`/finalization | Worker final commit | C → sorted D → P; lease transaction finishes first | Target +1 | Finalize or suspend still-owned mismatch | Existing worker outcome + internal receipt | P01 | 7 / R3b |
| Claim/release/retry lease | Execution token, not editorial revision | Provider schedule claim/release commands | Short operational transaction | P only; never then D | None for bookkeeping | Lease fields only | Claim outcome | P01 | 7 / R3b |
| Soft delete | Current-edit snapshot | SDK delete; host `collections/delete.ts`; core `deleteDocument` | Guarded delete with audit | C → sorted target/derived D → sorted P | Deleted target and changed derived rows +1 | Cancel target; suspend changed derived | Existing committed delete outcome + receipts / stale | L02, T01 | 6 / R3a; tree 7 / R3b |
| Storage un-delete | Explicit maintenance read | Provider `restoreSoftDeletedDocument`; internal tooling | Guarded maintenance transaction | C → D → P as needed | Restored target +1 | Never recreate prior schedule authorization | Internal affected-version count / stale; revision advances atomically | D01, M01 | 6 / R3a |
| Delete locale | Current-edit snapshot | Host `collections/delete-locale.ts`; core `deleteLocale` | Guarded content change | C → D → P | Target +1 | Suspend armed | New version + receipt / stale | L02 | 6 / R3a |
| Restore historical content | Current target edit snapshot, separate source version | SDK/host collection and singleton restore; core restore functions | Guarded restore | C/S → D → P | Target +1 | Suspend armed | New version + receipt / stale | L02, S01, A01 | 6 / R3a |
| Copy to locale | Current source/target document snapshot | Host collection/singleton copy; singleton SDK; core copy functions | Guarded locale copy | C/S → D → P | Target +1 if changed | Suspend armed | New version + receipt / stale | L02, S01 | 6 / R3a |
| Duplicate source | Source edit snapshot | Host `collections/duplicate.ts`; core `duplicateDocument` | Source guard + destination create | C → source D / existing affected D → new D | New copy = 1; unchanged source unchanged | Source schedule unchanged | New receipt + sourceRevision / stale | L02, T01 | 6 / R3a; placement 7 / R3b |
| Empty singleton first save | Authorized `getForEdit` empty-slot state | SDK singleton update; host `singletons/update.ts`; core `updateSingleton` | Final slot guard + create/map | S → new D | New document = 1 | None | Version + receipt / slot stale | S01, H01 | 5–6 / R3a |
| Existing singleton save | Authorized singleton editable snapshot | Same update path and singleton lifecycle coordinator | Guarded singleton save | S → D → P | Target +1 | Suspend armed | Version + receipt / stale | S01, L01 | 5–6 / R3a |
| Tree place/move/remove | Snapshot-consistent tree + target revision | SDK tree methods; host `collections/tree.ts`; core `placeTreeNode`/`removeFromTree` | Guarded structural mutation | C → sorted D → sorted P | Every changed placement/key target +1 | Suspend armed for changed targets | Structural receipts + safe suspension summary / stale | T01, H01, U01 | 7 / R3b |
| Child promotion/removal | Target revision + coherent structure | Core `promoteChildrenAndRemove` / delete reconciliation | Guarded structural/delete transaction | C → target/child/sibling D → P | Changed target/derived rows +1 | Cancel deleted; suspend other changed | Structural/delete receipts / stale | T01, L02 | 7 / R3b |
| Flat reorder and key repair | Editable row revision + observed gap | Host `collections/reorder.ts`; new core reorder; provider `setOrderKey` | One structural mutation | C → moved/repaired D → P | Every changed key row +1 | Suspend affected armed | Structural receipts + notice / stale | T01, U01 | 7 / R3b |
| Automatic root placement / self-heal | Initiating create/save observation | Core `appendTreeRoot`/`selfHealTreePlacement` | Initiating operation, not unguarded post-commit write | C before D → P | Included once in initiating revision | Suspend if existing target changed | Included receipt; review best-effort changes | T01, L01 | 7 / R3b |
| Existing-field upload attachment | Loaded edit snapshot | Host `collections/upload.ts` with `createDocument=false`; final patch/save | Preparation external; guarded attachment | C → D → P at attachment | Only committed attachment +1 | Suspend at attachment | Prepared file then save receipt / stale | L01, H01, U01 | 5 / R3a |
| Upload creating media document | No existing target | Host upload with `createDocument=true`; core field upload create | New-document coordinator | As ordinary create | New document = 1 | None | Stored file + version/receipt | L01, H01 | 5 / R3a |
| Source-locale re-anchor, PostgreSQL | Explicit per-target maintenance observations | `PgAdapter.reAnchorDocument(s)`; CLI copied script | Per-target guarded maintenance transaction | C → D → P | Actually re-anchored target +1 | Suspend armed | Per-target report + receipt / stale | M01, R01 | 6 / R3a |
| NULL source-locale normalization | Historical fallback established; no editor intent | `initBylineCore` → `backfillSourceLocales` | Boot maintenance before serving writes | UPDATE locks only NULL rows | None only for semantic-preserving normalization | None | Rows updated; no repeated boot churn | M01 | 3, 6 / R1, R3a |
| Media regeneration preserving status | Editable revision captured before image processing | CLI/webapp `regenerate-media-operation.ts`; `replaceDocumentFieldsPreservingStatus` | Core-owned guarded replacement, R0-1 approved | C → D → P | Target +1 once | Suspend armed | New version + receipt / stale; preserve observed status only | L01, L02, M01, R01 | 6 / R3a; 10 / R5 |
| Other internal document commands / seeds | Explicit maintenance observation or creation | Direct provider commands in first-party tooling and fixtures | Own or join private revision scope | Same order as operation | Changed existing target once | Same editorial invalidation rule | Internal receipt; no SDK bypass | D01, M01, R01 | 6, 8 / R3a, R4 |
| Indexing/analytics/cache operations | Not editorial mutation | SDK index/remove/reindex; providers/hooks | Existing operational transaction | No editorial lock escalation | None | None | Existing result | Regression tests | 11 / R5 |

## Task 1 — Freeze the mutation, response, and locking contracts

- [x] Inventory every existing-document mutation from admin action to host/SDK to core to adapter. Include content, system fields, status/unpublish, schedules, delete/restore, locale operations, duplication source, singleton first save, tree/reorder, uploads, re-anchor, maintenance, and scheduler execution. Include list/history actions and copied CLI examples.
- [x] Populate the Coverage ledger section above, with one row per operation: observed revision source, entry points, owning transaction, records locked, revision advances, schedule effects, result/error shape, and test names. Distinguish direct targets from derived sibling/child effects.
- [x] Freeze concrete TypeScript signatures for required `expectedRevision`, mutation results containing committed revisions, and `ERR_DOCUMENT_STALE` details/decoders. Define the empty-singleton precondition explicitly as an empty-slot variant, separate from missing input and numeric revisions.
- [x] Define an explicit editable-read result distinct from published/historical results. Prefer a dedicated current-edit read surface that returns a coherent document snapshot and numeric revision; ordinary public reads retain their current defaults. Decide how list/tree action rows obtain coherent observed metadata and revisions. A displayed content version must not be paired with another version's current token.
- [x] Define a private adapter snapshot capability using a read-only repeatable-read transaction on one connection for all SQL that assembles an editable result. Source content, paths, locales, status, and schedule UI state must share that snapshot. Ordinary public reads remain outside this new path. Thread read executors explicitly or through an adapter-owned scope; do not assume `withTransaction` changes the raw-pool readers. If this requires disproportionate query-builder changes, evaluate the specifically bounded revision-bracket fallback in Task 4 and record which operations use which strategy at R0. Do not silently switch strategies during implementation.
- [x] Define a universal lock order: structural collection lock where needed, singleton slot lock where needed, document rows in stable identity order, then schedule rows. Inventory current reverse-order paths, including worker claims and deletion. Discover derived targets under the structural lock, then lock and revalidate before applying writes. No transaction may acquire an earlier lock class after holding a later one.
- [x] Define the private mutation boundary's ownership of comparison, one revision advance per changed document, nested storage calls, schedules/audit, and after-hook dispatch. Retain existing parent checks. Database operations must use current locked state, not an older repeatable-read snapshot captured before acquiring the write lock.

**Primary artifacts:** this plan's coverage ledger and [R0 contract note](./2026-09-05-stale-document-write-protection-r0.md); proposed changes mapped to `packages/core/src/@types/db-types.ts`, `packages/client/src/types.ts`, adapter `lib/db-manager.ts` and query builders. This task does not require implementing the interfaces yet.

**R0 — Reviewer checks:** Every spec coverage row has an owner and test destination. Review concrete empty-slot/read types, all lock sequences, public-read isolation, and the signatures to be migrated. Resolve transaction reentrancy from user hooks and long-running upload preparation explicitly. Approve the design before schema or orchestration work begins.

## Task 2 — Add typed revision and error foundations

- [x] Add a shared positive-safe-integer revision validator and checked database-value conversion. Keep the database `BIGINT`, exposed as a number bounded by `Number.MAX_SAFE_INTEGER`.
- [x] Add `ERR_DOCUMENT_STALE` and typed variants for `revision_mismatch`, `version_parent_mismatch`, and `singleton_slot_changed`. Add typed missing/invalid revision validation details and public runtime decoders safe for serialized unknown values.
- [x] Keep raw `DocumentVersionParentConflictReason` intact. Add explicit lifecycle normalization for its stale variant; do not normalize missing parent, path uniqueness, ordinary workflow conflict, or arbitrary `ERR_CONFLICT` into document staleness.
- [x] Define result contracts that separate rejected mutations from committed writes with after-hook failures and carry committed revisions. Preserve existing deletion side-effect reporting.
- [x] Update appropriate core barrels and public-export accounting without exporting adapter implementation details. Do not change generated collection field types.

**Tests:** core unit tests for null/undefined/string/fraction/negative/unsafe input, safe boundaries and overflow; each stale variant and malformed serialized details; unrelated conflict preservation. Use tests named `*.test.node.ts`.

### Task 2 implementation evidence — 2026-09-05

Implemented numeric revision validation and checked driver conversion; typed preconditions/receipts; dedicated stale errors and allowlisted runtime decoders; and private stale-parent normalization at `persistExistingDocumentVersion`. Raw adapter parent errors and unrelated conflicts retain their contracts. Existing mutation results will adopt the required revision receipt when revision persistence lands; no revision is fabricated for today's writes. Complete revision enforcement is not claimed at this foundation stage.

- `packages/core/src/@types/document-revision.ts`: shared input/result/error contracts.
- `packages/core/src/storage/document-revision.ts`: strict caller validation and BIGINT conversion.
- `packages/core/src/services/document-lifecycle/stale-document.ts`: serialized error decoding and private parent normalization.
- `packages/core/src/services/document-lifecycle/persistence.ts`: uses normalization at the existing persistence boundary.
- New focused tests plus one lifecycle regression test: stale persistence never fires success hooks or schedule suspension.
- Core `pnpm test`: **59 files, 1,097 tests passed** after the persistence integration.
- Core `pnpm exec tsc --noEmit`: passed.
- Scoped Biome checks: passed.
- `pnpm knip:exports`: passed after adding only the 15 new deliberate public-surface entries. The internal normalizer is consumed by persistence and is not in the public-export baseline.
- Database integration and browser tests: not run at Task 2; no schema/UI changes have been made. R1 is not ready until Task 3 is complete.

## Task 3 — Persist revisions and implement both provider primitives

- [x] Add non-null, no-default `revision` on logical document rows, with positive/safe-range enforcement in both dialects. Updated create commands explicitly insert 1.
- [x] Add the authorized document revision to persisted publication schedules using Task 1's contract. Existing armed schedules must become `needs_reconfirm` during upgrade; never infer prior authorization from backfilled revision 1.
- [x] Add native upgrade scripts at each provider's next available independent number. Preserve released SQL byte-for-byte. Use the source-locale add/backfill/tighten precedent, but perform revision backfill in the fenced upgrade window. MySQL upgrades must be idempotent and re-runnable after every completed DDL statement; do not describe an outer transaction as rolling back implicit DDL commits. Use the explicit staged/resume protocol below.
- [x] Generate and apply incremental development Drizzle migrations through the existing commands, alongside the independent downstream numbered SQL scripts. Preserve the development chain until the reviewed squash in Task 10. Do not hand-format migration metadata or apply a fresh baseline to an occupied database. The final single-file CLI baseline is produced after that squash, as specified by the user.
- [x] Implement transaction-scoped document lock/read and guarded revision advance primitives. A stale or missing document must not reach mutation code. Enforce stable multi-document lock order and preserve parent-version assertions under the same document lock.
- [x] Add startup schema/capability validation for the new contract, before boot maintenance or write traffic. Provide an actionable upgrade error for an old schema or adapter. Confirm raw driver conversions preserve safe numbers in both providers.
- [x] Extend shared conformance registration and both provider harnesses. Build deterministic race helpers using separate connections and explicit barriers/locks, not sleeps or only `Promise.all` timing.

**Tests:** fresh database creation; occupied pre-upgrade fixture; backfill preserving data; migration re-run/resume; no revision default; old inserts fail; old updates demonstrably are not blocked by `NOT NULL` alone; startup rejects incompatible schema/capability; stale compare-and-advance, rollback, overflow, and nested transaction behavior on both providers. Keep operational access-fencing acceptance separate from CI.

**MySQL upgrade/resume protocol:** Inspect schema state before each DDL stage and skip an already-correct column/constraint; an existing incompatible definition must fail with a named stage and remediation rather than being silently accepted. Order stages as: add nullable revision/authorization columns; backfill only missing document revisions and transition only legacy armed schedules lacking authorization; verify data/ranges; tighten constraints and remove defaults; verify the entire target schema. Use transactional DML batches where appropriate, without relying on DDL rollback. Never reset non-null counters or suspend newly authorized schedules during a rerun. A recorded stage marker alone is insufficient: verify the actual schema and data before skipping work.

Keep writes fenced throughout a failure. The runbook must identify each stage, how to inspect its completion, and how to resume by rerunning the same script after correcting the reported issue. Do not reopen writers until final validation passes. For this release, forward resume is the supported recovery for a partial upgrade; restoring from backup is an operator recovery procedure, not a claimed SQL rollback. Test interruption after each DDL stage and committed DML stage, then rerun to the same final schema/data as an uninterrupted upgrade. Include a deliberate incompatible partial schema and verify it stops with an actionable diagnostic. These are automated database migration tests, separate from operator credential-fencing checks.

### Task 3 implementation evidence — R1 passed, 2026-09-05

All Task 3 implementation work is complete. The [R1 handoff](./2026-09-05-stale-document-write-protection-r1.md) records source references, the MySQL staged resume procedure, exact commands, development database migration records, and remaining checkpoint boundaries.

- Both providers implement transaction-scoped revision locks and guarded advance, with safe numeric conversion, canonical identity order, parent checks, rollback/savepoints, and observation lifetime enforcement.
- Startup validates the required adapter capability and schema before any boot maintenance or reconciliation writes.
- Native numbered SQL preserves all 13 scripts released at `v4.19.0`. Native/incremental equivalence, occupied/fresh schema upgrades, reruns, incompatible partial schemas, and MySQL connection-loss resume have executable coverage.
- Final provider integration runs: PostgreSQL **269 tests / 8 files**, MySQL **294 tests / 11 files**, with no skipped tests. Each engine runs the 15-case shared revision suite. Migration suites contain 9 PostgreSQL and 10 MySQL cases.
- Node tests: core **1,104**, client **128**, PostgreSQL **46**, MySQL **324** passed. Package typechecks and core/provider builds passed; root typechecking completed all 44 Turbo tasks. Root Knip and the public-export audit passed, with 1,207 known export entries.
- Incremental Drizzle migrations applied to the local development databases as well as test databases. Development document counts stayed at 186 (PostgreSQL) and 2 (MySQL); original ledger entries were preserved and appended hashes verified. No squash or CLI baseline replacement occurred.

R1 passed with one open non-blocking finding, R1-1 (see Review records). These foundations are not independently releasable while existing lifecycle writers remain unconverted. Task 4 passed R2 review; see its evidence and Review records below.

**R1 — Reviewer checks:** Inspect SQL, migration/template equivalence, actual transaction executor use, no-default/range semantics, schedule upgrade behavior, and deterministic race evidence for both engines. Confirm these foundations are not presented as a releasable enforcement guarantee yet.

## Task 4 — Provide coherent editable snapshots

- [x] Implement Task 1's approved read strategy in both adapters. The preferred strategy is the read-only snapshot capability, routing all queries used to build editable responses through its connection. PostgreSQL requires explicit repeatable-read semantics; do not rely on its default read-committed isolation. Configure MySQL explicitly rather than relying on server defaults. The only named alternative design to evaluate is the revision-bracket fallback below, subject to reviewer approval and the R0/R2 evidence requirements.
- [x] Assemble the source document's selected content, current metadata, revision, and schedule controls coherently. Include the source status and current version identity needed by actions; preserve authorization, `beforeRead`, locale rules, and read-hook behavior.
- [x] Prevent hooks or response shaping from substituting a current revision into old content. Define a narrow source-document snapshot lifetime; do not hold database locks while editors type, or extend write locks through unrelated external calls.
- [x] Wire SDK/admin editable read results, empty singleton reads, and action-capable list/tree results. For published/historical reads, expose no usable current edit revision even if the selected historical content happens to be the current version today. A history Restore action obtains the current target precondition independently of its source version ID.
- [x] Preserve ordinary published reads, relation population, and search result behavior without added write-related queries or transactions. Revision checking protects the source document; it does not promise a cross-document collaborative snapshot of every related target.

**Tests:** force a writer between source/version selection and metadata/field reconstruction and prove the editable response is entirely before or after the mutation. Exercise content, status, path/locales, and singleton state. Cover historical/published token absence, authorization/redaction, and public read query behavior. Both provider suites must exercise the snapshot race.

**Named fallback — revision-bracketed assembly:** When threading snapshot executors is too invasive, an editable source-document read may instead read its revision, document identity, current content version ID, and liveness from the authoritative writer database, assemble all source fields and editable metadata, then read the same marker again. Accept the assembled response only if both markers match and the assembled content version belongs to that observed current state. Use fresh committed reads, with no replica/cache mixing, dirty reads, or ambient old snapshot. Every source query must occur between the two marker reads. The fallback depends on every editorial mutation atomically advancing revision; it cannot establish the release guarantee while old writers remain active.

On mismatch, discard the entire assembly, including any token, and allow at most one fresh raw read attempt. A second mismatch returns an explicit retryable read failure with no editable payload; the host offers a refresh/retry without pretending a save was rejected or discarding an existing dirty form. This is bounded retry of read assembly, never retry of a mutation. Run before-read authorization/scoping once for the logical read and preserve it across attempts; do not replay user hooks or their side effects. Run after-read processing only on a validated assembly. Do not return old fields with the final marker or refresh only the token.

The fallback can prove coherence for one source document, because its marker cannot change and return to its old value. For an empty singleton, bracket the slot mapping as well as document identity/revision and handle a concurrently filled slot explicitly. For list rows, bracket each action-bearing source as required. Per-row markers alone do not prove collection membership, sibling gaps, or tree topology: use the preferred snapshot path for those structural observations unless R0 approves an equivalent structural guard covering the entire observation. Related-document population retains existing semantics; it is not represented as a coherent multi-document editable snapshot.

At R0, document the query-builder cost that motivates fallback and its exact eligible read paths. If that cost is discovered after R0, submit the limited read-strategy decision to the reviewer before implementing the alternative. At R2, demonstrate mutation during assembly, rejected mismatched content/metadata, exhausted read retry, unchanged hook invocation counts, and empty-slot races on both providers. If these conditions cannot be proven, retain the snapshot strategy; a best-effort or weaker consistency promise is not an acceptable fallback to the approved spec.

**R2 — Reviewer checks:** Trace one coherent edit response in each dialect and verify it cannot combine old fields with a new revision. Check empty singleton ambiguity, selected/list/tree responses, and no accidental change to public SDK defaults. This checkpoint blocks mutation integration because a correct guard with an incorrect token-bearing read remains unsafe.

### Task 4 implementation evidence — R2 passed, 2026-09-05

The [R2 handoff](./2026-09-05-stale-document-write-protection-r2.md) records source links, D02/A01 read evidence, exact verification, and limitations.

- Both providers construct explicit read-only repeatable-read query facades on one executor. Locking reads and class internals are absent, and the facade expires after its callback, including nested schedule methods.
- Explicit SDK document/list/singleton/tree edit reads carry coherent source observations. A whole-tree variant includes scoped unplaced documents in the same snapshot with deterministic document-ID pagination. Public and historical methods remain token-free.
- Before-read scoping runs before snapshots; population and after-read hooks run afterward. Reserved identity, version, workflow status, and revision survive hook substitution attempts; field and optional metadata redaction remain effective.
- Admin loaders preserve revisions through parsing and row shaping, use the captured schedule state, and distinguish an empty singleton slot from an unavailable mapped document. Historical restore loaders fetch the current target independently of source history.
- Seven shared snapshot cases pass per engine. Full integrations passed: PostgreSQL **276 tests / 8 files**, MySQL **301 / 11**, SDK **166 / 19**, without skips. Core **1,105**, client **128**, and host **32 jsdom + 157 node** tests passed. Root typechecking passed all **44** tasks; Knip and the **1,214-entry** export audit passed.
- Documentation passed through the sandbox-compatible command (**69 documents / 692 links**). The supplemental client test-tree TypeScript command failed on stale declarations and incomplete mocks; it is explicitly recorded as failed in the handoff, not counted as a gate pass.

R2 passed with open non-blocking findings R2-1 and R2-2; Task 5 is unblocked. See Review records for the independent evidence and assigned follow-ups. No mutation enforcement, migration, squash, or R1-1 schedule-reason change is claimed by Task 4.

## Task 5 — Implement atomic content and metadata saves

- [x] Address R2-2 during preparation: pin the complete document-facade key set in shared snapshot conformance case 7 and verify both providers before R3a.

- [x] Extend/refactor `commitContentVersionWithScheduleSuspension` and `persistence.ts` into the approved guarded operation boundary; preserve `audit.withTransaction` and adapter savepoints rather than creating another unrelated transaction abstraction.
- [x] Compare the observed revision before changing any database state. Use a private already-guarded context or similarly explicit ownership so nested helpers neither recompare against a newly advanced revision nor increment twice. Do not expose this internal mechanism as an unconditional SDK/core option.
- [x] Add a combined save operation for content patches and optional path/locales. Execute path uniqueness validation/write before content insertion, after the revision check, within one shared transaction. Roll back path/locales, version, audit, schedule changes, and revision together.
- [x] Convert full replacement and standalone system-field writes to the same precondition rules, keeping current no-op behavior only for current revisions. Retain date/numeric normalization, counters, immutable locale carry-forward, and source-locale semantics.
- [x] Implement the single-document schedule effects required by these saves now: content/metadata edits suspend armed schedules transactionally and advance revision once. Tasks 5–6 also preserve status/unpublish/delete cancellation. Task 7 adds arm/reconfirm/worker and derived structural effects; do not defer the save-side guarantees needed for R3a until then.
- [x] Preserve hook ordering and committed-hook result classification. Detect already-stale requests before preparation; recheck after any preparation outside the transaction. Never automatically replay hooks or patches on a newly fetched revision.
- [x] Cover first creation, singleton saves, deferred upload field attachment, and direct upload-to-new-document behavior. Return initial/committed revisions and treat external object persistence as preparation rather than successful document saving.

**Tests:** atomic combined failure at path, content, audit, and schedule stages; no-op versus stale no-op; same-revision competing saves; full replacement based on an old observed state; upload attachment conflict; post-commit failure carries the committed revision. Assert after-hooks do not fire on rejected mutations and database state remains unchanged.

### Task 5 implementation evidence — implemented, R3a pending

The [Task 5 evidence](./2026-09-05-stale-document-write-protection-task5.md) maps L01/D01, S01, A01/H01, and upload coverage to the implementation and executable tests. It records the converted SDK/host callers, transaction boundaries, initial/committed receipts, save-side schedule invalidation, and remaining Task 6–9 boundaries.

- Both providers pass 21 new shared guarded-save cases, plus the revised physical-connection singleton first-save race and stale uploaded-file attachment assertions. Full integrations passed without skips: PostgreSQL **297 tests / 8 files**, MySQL **322 / 11**, SDK **168 / 19**.
- Core **1,106**, client **128**, and host **33 jsdom + 157 node** tests passed. Root typechecking passed all **44** tasks. Scoped Biome, Knip, and the **1,217-entry** public-export audit passed.
- Generated types are current for six collections (`1350833324d2`). The root generation wrapper failed on sandbox `tsx` IPC; its equivalent `node --import tsx` script passed. Documentation passed through the same sandbox-compatible invocation (**69 documents / 692 links**).
- The upload creation error path now preserves files when `afterCreate` fails after commit, and propagates the committed revision. Genuine insertion failure still cleans up prepared files.
- Metadata/content hooks execute outside final mutation locks; metadata after-hooks precede content after-hooks. The combined admin save sends one request carrying the loaded revision.
- Task 6 must replace the media-regeneration outer transaction, which the new guard rejects. Task 7 still owns automatic tree placement/self-heal integration and schedule workers. Common committed-hook revision typing remains optional until Task 6 producers are converted. This is not a releasable global enforcement guarantee.

No R3a verdict is claimed. No migration-file changes, development ledger edits, squash, CLI baseline replacement, or deployment occurred in Task 5.

## Task 6 — Cover remaining lifecycle and maintenance mutations

- [x] Resolve T5-1 with the media replacement: replace the four explicit pending operation tests with real-adapter execution of the shared core entry point and an alias-identity test; eliminate the misleading adapter double, without `as unknown as IDbAdapter` or equivalent unchecked casts. Add real-adapter integration coverage on both providers through the replacement entry point, exercising transaction ownership, stale rejection, one revision advance, preserved status, published archival, absence of the false status-change audit, and rollback. A green mock-only suite does not close this finding.

- [x] Require revision inputs for status/unpublish, delete/delete-locale, restore/copy-to-locale, duplicate source, singleton variants, and maintenance re-anchor. Read current state only after the authoritative guard; do not substitute a server-fetched revision for the caller's value.
- [x] Keep status transition validation, content parent integrity, permission checks, and immutable media retention. A stale publish must never resolve to newer content. A current metadata/status mutation advances revision without creating a content version.
- [x] Require the explicit empty-slot expectation for first singleton save under the slot lock. One first-save contender succeeds; the other receives the singleton stale variant. Omission remains a validation error.
- [x] For duplication, validate the source and create the copy in the same logical transaction, advancing only genuinely changed documents. For historical restore, keep current target revision and historical source version separate.
- [x] Under the approved R0-1 decision, replace the CLI and webapp media-regeneration outer-transaction composition with the guarded status-preserving maintenance path defined in the R0 note. Carry the observed revision from before processing, preserve arbitrary declared observed statuses without an arbitrary status override, and test content/bookkeeping rollback and published archival. Deliberately omit the old `document.status.changed` row: preserving status creates no status transition.
- [x] Update PostgreSQL `reAnchorDocument`/`reAnchorDocuments` and copied-template examples: read target revisions explicitly before an actual write, preserve dry runs, and invalidate revisions on actual changes. Preserve the narrow idempotent NULL-source-locale normalization exception; no revision churn on ordinary startup.
- [x] Audit lower-level first-party writers such as seeds and operational tooling. Revision-changing maintenance must join the same lock discipline; direct DB primitives remain internal, not a supported caller bypass.

**Tests:** a table-driven stale/current/no-op/missing-precondition matrix for every operation, including separate locale saves, stale duplicate/restore, deleted/unavailable records, permission failures without leaked state, and repeat startup. Supplement shared conformance with PostgreSQL-only re-anchor tests.

**R3a — Reviewer checks:** Inspect Tasks 5–6 using the coverage ledger. Require both-provider evidence for atomic Save, stale publish, first-save singleton races, rejected SDK replacement based on stale observations, rollback, and single-document schedule suspension/cancellation. Review duplicate's source guard and destination creation, which belong here even though duplication creates another document. Confirm hook/side-effect limits, no public bypass, and one increment per changed target. All affected public callers must compile with explicit observations. Record remaining worker and structural work as Task 7 scope, not as failing or completed R3a coverage.

### Task 6 implementation evidence — implemented, R3a passed

The [Task 6 evidence](./2026-09-05-stale-document-write-protection-task6.md) maps the remaining lifecycle, singleton and maintenance rows to code and executable cases. It records required inputs and receipts, current no-ops, post-preparation stale races, transaction rollback, caller conversions, the guarded PostgreSQL batch surface and the first-party raw-writer audit.

- T5-1 is addressed: both media scripts use the same guarded core entry point; 14 real-adapter cases now cover the replacement on each provider, including the R3a exclusive-lock assertion. The dedicated webapp suite has 6 executable tests and no todos or adapter casts. Preserved published status archives superseded publication; no false status-change audit is emitted. The R3a reviewer confirmed T5-1 closed.
- Full integrations: PostgreSQL **352 tests / 8 files**, MySQL **373 / 11**, SDK **168 / 19**, without skips. Core **1,106**, client **128**, host **33 jsdom + 157 node**, provider units **46 PostgreSQL + 324 MySQL**, root typechecking **44 tasks**, Knip and the **1,216-entry** export audit pass. The evidence note records command scope and diagnostics; this is implementer evidence, not a review verdict.
- R3a-1's narrower policy is approved and implemented: ordinary flat-document writes take shared collection registration locks (PostgreSQL `FOR KEY SHARE`, MySQL `FOR SHARE`); deletion, maintenance, trees and singleton coordination retain exclusive locks. The mode is selected before document locks, without a later shared-to-exclusive upgrade. The general command is `collections.lockCollectionRegistration`; singleton `lockSlot` delegates with exclusive mode. Both providers run a barrier test proving that another document can commit while the first save holds its locks. Task 7 still owns derived tree/reorder effects and worker integration.
- Committed-hook revisions are now required across the converted producers. Status and unpublish after-hook failures carry a committed receipt; hook execution remains outside final mutation locks.
- R1-1 remains Task 7; R2-1 remains Task 8/R4. No migration edits, development-ledger reconciliation, squash, CLI migration baseline replacement or deployment occurred in Task 6. R3a is now recorded as passed following independent review.

## Task 7 — Integrate schedules, trees, and reorder consequences

Task 7 passed independent R3b review on 2026-09-05 with no blocking findings. The [Task 7 evidence](./2026-09-05-stale-document-write-protection-task7.md) maps the worker, structural, migration and lock-conflict changes to executable cases and records the remaining Task 8/9/10 boundaries.

- [x] R3a-4(b): classify provider deadlock/serialization and lock-wait failures and translate them at the owned transaction boundary to a distinct typed lock-conflict error, after the entire mutation has rolled back. Preserve the underlying cause in server diagnostics, without exposing driver SQL/messages as the public contract. A lock conflict does not prove a stale revision: do not label it `ERR_DOCUMENT_STALE`. Mark it eligible for an explicit caller retry only when rollback is confirmed; connection loss or uncertain commit outcomes must not be misclassified. Never automatically retry or fetch a newer revision. Cover both provider classifications, full rollback (including statement-only lock-timeout behavior), and SDK/host propagation at R3b. Final error naming and transport shape are implementation details for that checkpoint.

- [x] R1-1: add `upgrade_invalidated` to both schemas and fail-closed startup checks, generate a new incremental Drizzle migration without rewriting applied history, and update the unreleased numbered SQL upgrades. Verify native/incremental occupied-data outcomes and MySQL interruption/resume behavior. No development-ledger reconciliation or squash is performed in Task 7.

R3a carry-forward: worker execution must select the appropriate shared/exclusive collection registration lock before document and schedule locks, accounting for collection foreign-key writes. Never upgrade a shared collection lock after taking document locks. This supersedes R0's worker document-first exception; schedule-only claim leasing remains a separate transaction.

- [x] Store the resulting document revision as a schedule's authorized revision when arming/reconfirming. Require the observed revision alongside existing target-version constraints. Cancellation and schedule changes advance revision once when they change state.
- [x] Suspend armed schedules on content and metadata/structural changes with the spec's typed reasons. A combined mutation plus suspension advances once; already-suspended schedules stay suspended and are not silently reauthorized.
- [x] Update worker execution to follow Task 1's lock order and validate claim ownership, armed state, authorized revision, content target, and authorization before publishing. Publication/finalization/revision advance must be atomic. An unexpected mismatch suspends only a still-owned armed schedule; never publish or refresh authorization automatically.
- [x] Convert tree placement/removal/promotion and flat `reorderCollectionDocument`, including its direct `setOrderKey` calls. Lock structural scope, determine affected targets, compare explicit target preconditions, retain neighbor/gap checks, and mutate atomically. Advance every genuinely changed derived document once.
- [x] Include schedule suspension for affected siblings/children. Return an authorized suspension summary separate from structural success and post-commit hook warnings, enabling the required UI notice without disclosing hidden targets.
- [x] Cover creation auto-placement and self-heal placement so they do not double-increment the initiating revision or run an unguarded second editorial write. Preserve deliberate best-effort behavior only where it does not contradict atomicity; bring any necessary behavioral deviation to review rather than hiding it in a helper.

**Tests:** arm/reconfirm self-consistency; metadata suspension; worker versus save/status/delete races; claim loss; cancellation rollback; reorder plus sibling-schedule effects; failed multi-target compare with no partial changes; opposite-direction structural operations under controlled concurrency. Validate no deadlock-inducing lock-order inversion between worker and editor code. A timeout is failure evidence, not a passing concurrency result.

**R3b — Reviewer checks:** Inspect Task 7's schedule authorization, worker/editor lock interactions, structural lock sets, derived revision advances, and affected-schedule summaries. Require controlled worker/save/status/delete races and multi-target rollback evidence in both providers. Confirm claim bookkeeping cannot invalidate its own schedule or invert the lock order. Reuse R3a's approved evidence; review Tasks 5–6 again only where Task 7 changed shared behavior or exposed a regression. A Task 7 rejection blocks R3b and onward work, not an automatic reopening of unaffected R3a decisions. All affected public callers must compile with explicit observations; no “fetch latest and retry” fixes.

### Task 7 checkpoint evidence — R3b passed

The [Task 7 evidence](./2026-09-05-stale-document-write-protection-task7.md) records implementation, migration boundaries, exact test scope and diagnostic failures. PostgreSQL **378 / 8 files**, MySQL **399 / 11**, and SDK **169 / 19** pass without skips. Each provider passed **10 consecutive runs of 134 selected concurrency tests**; the full runs cover the remaining regression cases. Core **1,109**, client **128**, provider units **54 PostgreSQL / 331 MySQL**, and host **33 jsdom + 158 node** pass. Root typechecking passes **44 tasks**, Knip is clean, and the public-export audit remains **1,216 entries**.

R3a-4(b) classification/rollback/propagation and R1-1's distinct upgrade reason passed R3b review. Task 9 still owns editor presentation. R2-1 remains open: the supplemental SDK test-tree typecheck reports **103 diagnostics**, which are not passing evidence. No development database migration, ledger reconciliation, squash, CLI baseline replacement or release was performed in Task 7. R3b is recorded as passed below; the reviewer independently repeated each full provider suite ten times.

## Task 8 — Finish SDK, host, and first-party API conversion

- [ ] Audit `CollectionHandle`, `SingletonHandle`, core exports, all collection/singleton server functions, admin services, and upload transports. Require `expectedRevision` in TypeScript and validate raw payloads at runtime. Update calls mechanically alongside Tasks 5–7 where necessary.
- [ ] Supply observed revisions from the editable snapshot, including list/tree, history/restore, status, schedules, duplicate, and delete actions. For empty singleton saves, preserve explicit slot state rather than converting a null published result into “empty.”
- [ ] Replace the host's two-request combined Save with the single atomic core operation. Preserve success versus committed-hook-failure responses and include the committed revision.
- [ ] Add transport-safe serialization/decoding for typed stale errors and missing-revision old-client errors. Do not identify stale state by matching English strings or by treating all conflicts alike.
- [ ] Update SDK consumers, app-owned scripts, CLI templates, and documentation examples to perform an explicit current edit read before writes. Show historical/published restrictions rather than changing read defaults. Avoid unchecked casts to satisfy required options.
- [ ] Resolve R2-1 and its T5-1 extension: audit adapter doubles in both excluded test trees and root-typechecked application tests; remove unchecked adapter casts that hide required capabilities, then repair SDK test adapter mocks for the required revision/snapshot capabilities and subsequent mutation signatures, using typed contracts rather than unchecked casts. Run the supplemental client test-tree typecheck and report any remaining unrelated diagnostics separately; keep mock-contract evidence current through R4.
- [ ] Verify response helpers cannot copy a current token onto a filtered historical document or populate target. Keep revision metadata out of generated schema field shapes.

**Tests:** SDK type contracts reject omitted options; raw JavaScript/host requests fail closed; numeric revisions round-trip through actual server-function serialization; each stale variant remains decodable; old browser payloads get reload-required handling; unrelated conflicts remain distinct. Run template compilation against built packages, not just package TypeScript.

## Task 9 — Add admin stale-state and recovery behavior

- [ ] R3a-4(b) presentation: render the typed lock conflict from Task 7 as a safe action failure (for example, “This change could not be saved because another operation was using the document. Reload before trying again.”). No automatic resubmission or latest-revision retry; distinguish this from a proven stale-document conflict and from a committed after-hook warning. Test deletion as well as save paths, and prevent raw driver detail from becoming the editor message.

- [ ] Add a shared stale-document state for collection and singleton editors. Show the spec's persistent warning, retain fields/patches, and disable all mutation controls until reload. Include metadata, status, schedules, duplicate/delete, locale operations, and any structural controls in that view.
- [ ] Implement explicit Reload document as discard-and-refetch. Reset editable content, metadata, revision, pending patch/upload state, dirty baseline, and warning coherently. Keep ordinary navigation guards; do not automatically clear changes on conflict.
- [ ] Handle deleted/unavailable documents and old clients without revisions with specific reload/unavailable messaging. Preserve permission boundaries and committed-save warnings.
- [ ] Add list/tree stale warnings and refresh behavior. For successful structural mutations that suspend schedules, show a separate reconfirmation notice and an authorized review path, including derived siblings/children. Do not imply the committed reorder failed.
- [ ] Update translations in all shipped admin locale bundles, accessible announcements, focus handling, and keyboard operation. Avoid creating generic React primitives in admin when an existing UI primitive suffices.
- [ ] Add two-editor Playwright coverage with independent browser contexts. Exercise content conflict, metadata-only invalidation, stale publish, and reload/discard; use component/integration tests for the broader operation matrix and schedule notices.

**Tests:** explicit jsdom tests for retained dirty state, disabled actions, unchanged token after rejection, reload reset, unavailable state, accessible warning and schedule notice; actual host transport tests; browser test proving Alice's saved state survives Bob's rejected save and Bob can proceed only after reload.

**R4 — Reviewer checks:** Review a browser walkthrough or captured evidence from two independent contexts, the actual serialized stale result, the SDK omission tests, and a structural suspension notice. Verify a generic error toast has not replaced the required persistent warning and that no action control bypasses stale state. All first-party runtime consumers and copied templates must now be converted.

## Task 10 — Write migration guidance and release artifacts

- [ ] Update developer references for revisions, SDK mutation signatures, current-edit reads, warnings, schedules, and the accepted translation-workflow cost. Keep the approved spec as design history; document shipped behavior only when implementation is complete.
- [ ] Write separate PostgreSQL and MySQL cutover runbooks: pause all writers/workers, fence old credentials and terminate sessions, retain operator access/ownership, apply native upgrades/backfill, upgrade all integrations, verify access denial, then reopen writes. Explain why password rotation or `NOT NULL` alone is insufficient.
- [ ] Name copied re-anchor scripts, `regenerate-media.ts` and `regenerate-media-operation.ts`, and other generated app code explicitly. Provide before/after upgrade examples and a manual inventory checklist; package installation does not rewrite downstream source.
- [ ] Add R01 source-equivalence coverage for the CLI/webapp `regenerate-media-operation.ts` helpers; normalize their current import ordering, then prefer exact equality. Document/test explicit app-specific differences in executable callers rather than silently assuming template sync.
- [ ] Document schedule reconfirmation after upgrade, old-browser rejection, fail-closed startup, and unsupported rolling mixed writers/rollback to old writers after writes resume.
- [ ] After migration review, squash the development Drizzle migrations into one fresh baseline per provider; reconcile the explicitly identified development databases' Drizzle migration tables to that exact baseline without changing content. Use the single baseline for the CLI migration templates, and rerun baseline/template/artifact tests. Preserve the separate released numbered SQL upgrade history. Record the dev database identities and before/after bookkeeping; never rewrite downstream migration tables.
- [ ] Prepare changesets/release notes for the coordinated breaking surface and provider/CLI migrations according to current release tooling. Preserve released native SQL history and verify packaged baseline artifacts.

**Evidence:** automated migration/startup/template/artifact checks plus a separately labeled operator checklist. CI cannot certify credentials were revoked in a downstream installation; do not mark those deployment steps executed as part of repository tests.

## Task 11 — Close coverage and run final regression

- [ ] Map all 20 spec acceptance criteria to concrete test names or, for operator actions, explicit runbook checks. Resolve every blank coverage-ledger row. Inspect direct commands with `rg` again after integration to catch newly introduced paths.
- [ ] Run final gates below, preserve results, and investigate every new failure. Do not mark unrun integration/E2E checks as passed.
- [ ] Inspect the final diff for accidental formatting, generated output changes, public API omissions, and stale examples. Root lint modifies files; review its changes.
- [ ] Recheck the review record: R0, R1, R2, R3a, R3b, and R4 passed, findings resolved, no unresolved approved-spec deviations. Prepare R5 with commit/diff references and concise residual limitations.

**R5 — Reviewer checks:** Review the complete acceptance matrix, both dialects' regression results, template/package evidence, final API diff, and runbooks. Confirm no partial rollout is represented as safe and no test bypass fills missing revisions. Record release-readiness separately from authorization to merge, publish, or execute a production cutover.

## Validation commands and environment

Commands below were checked against manifests/configuration when this plan was written. Recheck them if the branch changes. Use Node 22 for CI parity and pnpm 11. Do not copy stale prose claiming the PostgreSQL package has no unit suite; its current `test` command runs node-mode Vitest.

During tasks, run only affected package typechecks and focused tests, then broaden at checkpoints when shared contracts warrant it. Representative focused commands:

```sh
pnpm --filter @byline/core test
pnpm --filter @byline/client test
pnpm --filter @byline/admin test
pnpm --filter @byline/host-tanstack-start test
pnpm --filter @byline/db-postgres test
pnpm --filter @byline/db-mysql test
pnpm --filter @byline/core typecheck
pnpm --filter @byline/client typecheck
```

For one node test, run `pnpm exec vitest run --mode=node <test-file>` from its package. For one React test in admin/host, use `--mode=jsdom`; plain `.test.tsx` does not run in node mode. Use actual files created by the task rather than assuming a filename in advance.

Build packages before integrations that consume `dist` exports. PostgreSQL/MySQL services and package-local `.env.test` files must be configured; one-time initialization uses `pnpm db:init:test` and `pnpm db:init:test:mysql`. Preserve `_test` database safety and existing serial execution (`maxWorkers: 1`, `isolate: false`, root integration concurrency 1). Within a single test, deliberate concurrent connections are required for race coverage. Do not run independent integration suites sharing the database in parallel.

```sh
pnpm build:packages
pnpm --filter @byline/db-postgres test:integration
pnpm --filter @byline/db-mysql test:integration
pnpm --filter @byline/client test:integration
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
```

For focused shared conformance, run `pnpm exec vitest run --mode=integration tests/conformance.integration.test.ts -t <suite-name>` from one provider package, then the other, using the suite name actually registered. Both adapters include that entry through `tests/**/*.test.ts`; confirm a nonzero executed test count.

Final static gates, in current CI order:

```sh
pnpm byline:generate:check
pnpm docs:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm knip:exports
git diff --check
```

Final runtime/artifact gates:

```sh
pnpm build:packages
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
pnpm test
pnpm test:integration
pnpm build
pnpm --filter @byline/webapp test:e2e
```

Also run current CI's non-UTC adapter/analytics integration gate if any shared temporal/schema behavior changed. Run `pnpm check:native-sql-history --base <previous-release-ref>` with a verified previous release ref recorded in the evidence; do not invent a ref or edit released scripts to make this pass. Follow the existing Drizzle generation workflow and inspect warnings/exit codes rather than hand-editing snapshots.

Playwright needs migrated/seeded `byline_dev`, configured admin credentials, and Chromium; tests mutate data serially. Use independent contexts for the same-document scenario. This is an implementation verification environment, not permission to exercise production data.

For documentation-only work, `pnpm docs:check` and whitespace/link checks suffice. If the tsx CLI hits the known sandbox IPC restriction, the equivalent checker invocation from `apps/webapp` is `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'`; record that substitution. The checker covers `docs/`, so separately validate this plan/spec's title, whitespace, and relative links.

## Reviewer handoff template

At each checkpoint append a short record here or link a tracked review note containing:

- Checkpoint and task IDs, implementation diff/commit references, and spec criteria covered.
- Concrete changes and any contract decisions frozen at that checkpoint.
- Exact verification commands, outcomes/test counts, and tests not run with reasons.
- Relevant race/snapshot/rollback evidence and UI evidence where applicable.
- Open findings, owner, and resolution; reviewer verdict of pass or changes required.

Do not carry a blocking finding into the next checkpoint without an explicit revised decision. Suggested review focus is intentionally narrower than a full repository review at every stage; R5 assesses the integrated result.

## Review records

### R0 — design readiness: passed, 2026-09-05

**Scope.** Task 1 deliverables: the [R0 contract note](./2026-09-05-stale-document-write-protection-r0.md) and this plan's 29-row coverage ledger, reviewed against the R0 checks in Task 1. All artifacts are uncommitted specification documents. No runtime code, migration, or database changed at this checkpoint, and no implementation is claimed.

**Criteria checked.**

| R0 check | Outcome |
| --- | --- |
| Every spec coverage row has an owner and test destination | Pass. All 15 specification coverage rows map onto ledger rows. Every ledger row carries entry points, owning transaction, lock set, revision semantics, schedule effects, result contract, test ID, and checkpoint. |
| Concrete empty-slot and editable-read types | Pass. `SingletonSavePrecondition` and `EditableSingleton` are discriminated unions; `getForEdit` returns `empty` only for an authorized, genuinely unmapped slot. |
| All lock sequences | Pass. Four-class collection → slot → document → schedule order, with the worker exception (document → schedule) and claim leasing as a standalone schedule-only transaction. |
| Public-read isolation | Pass. `withReadSnapshot` supplies a scoped facade; existing query objects continue on the pool; `ClientDocument` does not gain `revision`. |
| Signatures to be migrated | Pass. The SDK table covers all eleven `CollectionHandle` mutation methods confirmed in source. |
| Hook reentrancy and long-running upload preparation | Pass. Preflight, then preparation and before-hooks outside the final locks, then an authoritative recheck under those locks, with no replay. Singleton preparation moves out of the slot-lock interval. |
| Flagged compatibility decision | Resolved. See finding R0-1. |

**Implementation facts independently verified by read-only source inspection.**

| Fact | Evidence |
| --- | --- |
| Ordinary reads use the raw executor; only the `ForUpdate` read uses the ambient manager | `packages/db-postgres/src/modules/storage/storage-queries.ts:115`, `:141-151`, `:171` |
| Arming locks the document before the schedule | `packages/db-postgres/src/modules/storage/publish-schedules.ts:112`, `:135`, `:146` |
| The worker locks the claim before an unlocked metadata reread | `packages/core/src/services/document-lifecycle/scheduled-publish.ts:383`, `:390` |
| `claimDue` acquires no document locks | `packages/db-postgres/src/modules/storage/publish-schedules.ts:320` |
| Flat reorder issues repeated standalone `setOrderKey` calls | `packages/host-tanstack-start/src/server-fns/collections/reorder.ts:110`, `:125`, `:158` |
| The singleton slot lock spans preparation and `beforeSave` | `packages/core/src/services/singleton-lifecycle/internals.ts:94`, `:95`, `:115`, `:127`, `:129` |
| Automatic placement and self-heal run after content persistence, best-effort | `packages/core/src/services/document-lifecycle/create.ts:150`; `update.ts:153`, `:324` |

**Findings and disposition.**

- **R0-1 — blocking, resolved by user decision.** `packages/cli/src/templates/byline-examples/scripts/regenerate-media-operation.ts:85-87` calls `CollectionHandle.update` (typed at `:71`) inside an externally owned `withTransaction`, combining a lifecycle call with raw commands. This is the exact pattern the proposed restriction rejects, in a shipped CLI template with a downstream copy at `apps/webapp/byline/scripts/regenerate-media-operation.ts`. Decision recorded and approved: reject public lifecycle entry from external adapter transactions, and replace media regeneration with one guarded operation that preserves the observed status rather than allowing arbitrary status overrides. Both callers already pass `targetStatus: doc.status` (`apps/webapp/byline/scripts/regenerate-media.ts:234`; `packages/cli/src/templates/byline-examples/scripts/regenerate-media.ts:238`), so the replacement preserves behavior for all present usage while removing an unused arbitrary-status override that bypassed workflow transition validation. The restriction is consistent with [Transactions](../docs/03-architecture/03-transactions.md), which assigns boundary ownership to services and scopes ambient joining to commands. Two requirements carry into Task 6: retain the published-version archive step (`regenerate-media-operation.ts:92-97`), otherwise a regenerated published document leaves two published rows; and deliberately drop the `document.status.changed` audit entry, which becomes false once status is preserved by construction.
- **R0-2 — resolved in the contract note.** The proposed read-only facade originally exposed `getDocumentSystemFieldsForUpdate`, which cannot execute inside a read-only transaction. The note now defines `ReadSnapshotQueries` with type-level and runtime exclusion, an audit of the nested `publishSchedules` query surface, and JavaScript-caller tests.
- **R0-3 — assigned to Task 10.** The two `regenerate-media-operation.ts` copies had drifted in import ordering only. Task 10 now carries source-equivalence coverage under R01: normalize import ordering, then require exact equality, documenting any deliberate app-specific difference in the executable callers.

**Verification.** Reviewer verification was read-only source inspection of the paths cited above. No tests were executed by the reviewer and none are claimed. Implementer-reported documentation checks: `pnpm docs:check` was blocked by the tsx sandbox IPC `EPERM`; the equivalent invocation from `apps/webapp`, `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'`, passed, and the specification documents were validated separately for title and H1 match, trailing whitespace, final newlines, and relative links. No race, snapshot, rollback, or user-interface evidence applies at this checkpoint, because the design is not yet implemented.

**Verdict: pass.** No blocking finding is carried forward. Task 2 may begin. R2 confirms the `ReadSnapshotQueries` exclusion in the implemented adapters; R3a confirms the two R0-1 replacement requirements when the guarded media-regeneration operation lands.

### R1 — storage foundation: passed, 2026-09-05

**Scope.** Tasks 2–3: typed revision/error foundations, both provider schemas and guard primitives, native/incremental migrations, transaction ownership, and startup validation. The reviewing agent inspected the implementation and independently reproduced the evidence in the [R1 handoff](./2026-09-05-stale-document-write-protection-r1.md).

**Criteria checked.**

| R1 check | Outcome |
| --- | --- |
| Inspect SQL | Pass. Both scripts are staged and commented. PostgreSQL runs in one transaction. MySQL recomputes decisions from `information_schema`, with no retained session state or completion marker; stage 3 wraps both idempotent data updates in `START TRANSACTION`/`COMMIT`. |
| Migration/template equivalence | Pass, independently verified by diff. PostgreSQL native SQL without its outer `BEGIN;`/`COMMIT;` matches `0001_glorious_nehzno.sql` byte-for-byte; MySQL native SQL matches `0001_sour_komodo.sql` byte-for-byte. Independent native numbering is correct: PostgreSQL 0010 and MySQL 0005. CLI baseline replacement remains Task 10's post-squash work. |
| Actual transaction executor use | Pass. `DocumentRevisions` holds only a `DBManager`, with no raw database field; every query resolves through `this.manager.get()`. |
| No-default/range semantics | Pass. Both schemas use non-null `BIGINT` without a default, enforce 1–9007199254740991, and explicitly insert revision 1 at creation. MySQL stage 1 rejects unsigned and generated columns. |
| Schedule upgrade behavior | Pass. Legacy armed schedules without authorization become `needs_reconfirm` and lose their claims. No authorization is inferred from revision 1; reruns preserve existing counters and newly authorized schedules. The suspension reason label is tracked separately as R1-1. |
| Deterministic race evidence | Pass. Fifteen shared cases run per engine: eleven plain cases and two parameterized pairs. Deferred-promise barriers have a rejecting 10-second timeout; sleeps do not sequence the races. |
| Not a releasable guarantee | Pass. The handoff explicitly limits this checkpoint to foundations, the capability gate is present, and the code does not claim complete lifecycle enforcement. |

**Additional implementation checks.** The reviewer verified that `advance` combines a row lock with compare-and-set on the original revision and checks the affected-row count; overflow fails before a write; active tokens enforce savepoint observation expiry; parent normalization leaves missing-parent and unrelated conflicts unchanged; and scope bookkeeping uses `WeakMap`/`WeakSet` so completed transactions do not accumulate in retained maps.

**Verification independently reproduced by the reviewer.**

| Check | Reviewer result |
| --- | --- |
| Core node suite | 60 files / **1,104 passed**. |
| PostgreSQL integration suite | 8 files / **269 passed**. |
| MySQL integration suite | 11 files / **294 passed**. |
| `pnpm typecheck` | **44 successful** Turbo tasks. |
| `pnpm knip` | Passed. |
| `pnpm knip:exports` | Passed; **1,207 known entries**. |
| `pnpm check:native-sql-history --base v4.19.0` | **13 released scripts unchanged**. |

The reviewer did not rerun the client node suite (12 files / 128 tests) or provider node suites (PostgreSQL 46; MySQL 324). Those results remain implementer-reported, as recorded in the handoff.

**Finding R1-1 — open, non-blocking; owner: implementing agent.** Both upgrades label legacy schedule suspension as `document_metadata_changed`, although the cause is upgrade invalidation of authorization that cannot be reconstructed. The suspended state and cleared claims are correct; the label would give editors a false explanation when Task 9 renders the notice. The reviewer recommends a distinct typed reason such as `upgrade_invalidated`, which the specification permits without amendment. The recommended disposition is to fold this into the current migration work before the streams are finalized; carrying it to Task 7 is also permitted. That timing decision remains open, and no reason-label fix is claimed in this review record.

**Verdict: pass.** No blocking finding is carried forward. Task 4 is unblocked. R1-1 remains explicitly open and does not block editable snapshot implementation.

### R2 — read integrity: passed, 2026-09-05

**Scope:** Task 4, reviewed against the [R2 handoff](./2026-09-05-stale-document-write-protection-r2.md). The reviewer verified all seven criteria and independently reproduced the integration and static evidence below. The original handoff remains the implementation submission; this record supersedes its pending-review status and assigns its typecheck debt.

| Reviewer criterion | Outcome |
| --- | --- |
| Coherent editable response in each dialect | Pass. Both providers explicitly use read-only repeatable-read transactions. Identity, selected version, status, and revision are captured inside the snapshot; population and after-read hooks run afterward. Content, status, and path/locale race cases retain old fields with the old revision. |
| Empty singleton ambiguity | Pass. Only an unmapped slot produces the empty sentinel; a mapped but unavailable document returns null, matching R0. |
| Selected/list/tree responses | Pass. List selection remains selective. The forest and scoped unplaced list share a snapshot, with deterministic document-identity pagination. |
| Public SDK defaults | Pass. Editable types are additive; ordinary document and singleton methods retain their existing read behavior and do not gain revision tokens. |
| No inferred mutation safety guarantee | Pass. The handoff explicitly describes a read foundation, consistent with the implementation. |
| ReadSnapshotQueries exclusion, carried from R1 | Pass. The frozen runtime allowlist expires after the callback. The reviewer reconciled all 22 document-interface members: 20 allowlisted methods, the excluded locking method, and nested publish schedules. No current type/runtime mismatch was found. Future drift coverage is tracked as R2-2. |
| Snapshot coherence under concurrent writers, both engines | Pass. Seven cases per engine interpose inside field reconstruction after source selection. A second connection's commit establishes ordering; no sleeps or retry loops are used. |

**Independently reproduced verification:**

| Check | Reviewer result |
| --- | --- |
| PostgreSQL integration | 8 files / 276 tests passed. |
| MySQL integration | 11 files / 301 tests passed. |
| SDK integration | 19 files / 166 tests passed. |
| Root `pnpm typecheck` | 44 tasks passed. |
| `pnpm knip` | Passed. |
| `pnpm knip:exports` | Passed with 1,214 entries. The baseline diff adds 16 lines and removes none: R1's nine plus R2's seven intended editable SDK types. |
| Supplemental client test-tree typecheck | Failure reproduced: 110 diagnostics, including 59 TS2739 missing-adapter-contract diagnostics attributable to R1/R2. No diagnostic names the new editable-read integration file. |

The reviewer did not rerun the core, client, or host unit suites this round. Their passing results remain implementer-reported in the handoff. No tests were rerun merely to append this review record.

**Finding R2-1 — open, non-blocking; owner: implementing agent; assigned to Task 8 / R4.** The supplemental typecheck debt is mostly caused by this implementation: 59 of 110 diagnostics (54%) are TS2739 errors from legacy mocks missing the required revision/snapshot adapter contract. The test tree's exclusion from the configured package typecheck predates this work, but the new contract breakage does not. The original handoff's wording understated that distinction. Task 8 must repair these mocks and the additional signature drift introduced by Tasks 5–9, without unchecked casts, and record the supplemental check's remaining unrelated diagnostics separately. This replaces the handoff's unowned “outside Task 4” disposition.

**Finding R2-2 — open, non-blocking; owner: implementing agent; assigned before R3a.** Pin the complete sorted `Object.keys(queries.documents)` list in shared snapshot conformance case 7, mirroring the existing exact nested schedule-key assertion. The current type/runtime surfaces agree; the reviewer requests an explicit document-facade drift assertion for future additions. Carry this small test follow-up into Task 5 preparation. No assertion change or closure is claimed by this record.

**Verdict: pass.** Task 5 is unblocked. R2-1, R2-2, and the previously recorded R1-1 remain open and non-blocking. For R3a, the reviewer will check one increment per changed document, combined-save atomicity with path-conflict precedence, and hooks remaining outside the final lock interval.

### R2-2 implementation follow-up — closed, 2026-09-05

The implementing agent pinned the exact sorted document-facade key set in [shared snapshot case 7](../packages/db-conformance/src/suites/editable-snapshots.ts). Both final provider integration suites passed, including that assertion and the nested schedule-key assertion: PostgreSQL 297 tests and MySQL 322 tests. This closes R2-2 without changing the historical R2 review verdict. R2-1 remains assigned to Task 8/R4, and R1-1 remains open.

### T5-1 mid-task review follow-up — open, assigned to Task 6 before R3a

The reviewer confirmed R2-2 and the structural invariants, and independently reran PostgreSQL (297 tests). This was a proportionate mid-task check, not a gate verdict. MySQL, SDK, typecheck, and Knip were not rerun by the reviewer in this round.

The reviewer found that `regenerate-media-operation.test.node.ts` remained green over a runtime-rejected composition: a pass-through transaction and a cast-based adapter/SDK double could not exercise the real ownership check. Updating that double's revision arguments/receipt did not establish operation compatibility. The implementing agent accepts the finding.

Immediate correction: remove the misleading transaction/handle harness and its unchecked adapter/definition casts. Retain three pure-helper tests and mark four replacement-operation scenarios explicitly pending with Task 6 / T5-1 labels. Focused verification: `pnpm --filter @byline/webapp exec vitest run --mode=node byline/scripts/regenerate-media-operation.test.node.ts` reports **3 passed / 4 todo**. Those pending tests are missing coverage, not passing evidence. Task 6 must replace them alongside the operation and add real-adapter integration coverage; the R3a reviewer must verify both together. Task 8's R2-1 repair now explicitly includes unchecked adapter casts in root-typechecked tests, not only missing properties in excluded test trees.

### R3a — single-document enforcement: changes required, 2026-09-05

The reviewing agent found the Tasks 5–6 behavior and evidence substantially complete and closed T5-1. One blocking decision remained: exclusive collection locks for all ordinary writes prevented inversion but imposed an unapproved collection-wide serialization policy.

| Finding | Review outcome and follow-up |
| --- | --- |
| R3a-1 | Resolved by final reviewer. Originally changes required. The user approved shared registration locks for ordinary flat writes, retaining exclusive locks for deletion, maintenance, trees and singletons. Implemented and approved by the reviewer. |
| R3a-2 | Resolved by the reviewer. General collection locking must not masquerade as singleton slot locking. Both adapters now expose `collections.lockCollectionRegistration`; `singletons.lockSlot` delegates exclusively and failures use collection terminology. |
| R3a-3 | Resolved by the reviewer. Added a real-adapter concurrency regression. The new barrier test requires a second document's save to commit while the first save still holds its collection/document locks. |
| T5-1 | Closed by the reviewer: replacement operation, published archival, absence of the false status audit, dedicated tests, and real-adapter coverage verified together. |

The review accepted the remaining single-document criteria, including revision advancement, rollback, stale SDK replacement, singleton races and hooks outside final locks. R1-1 remains Task 7; R2-1 remains Task 8/R4. The initial verdict was **changes required**; the final pass record below supersedes it. Updated lock policy and final verification are recorded in [Task 6 evidence](./2026-09-05-stale-document-write-protection-task6.md).

### R3a-4 — deterministic race correction and lock-error scope, 2026-09-05

The reviewer closed R3a-1/2/3 and confirmed the remaining Tasks 5–6 criteria, but found intermittent MySQL failures in the raw storage write/delete race: two failures in nine runs. Its unconditional deletion-success assertion chose a winner without coordinating the order. R3a remained **changes required** until the reviewer verified R3a-4(a); see the final pass record below.

R3a-4(a) now holds the deletion's collection/document locks inside an outer transaction before starting the competing version write. The provider's physical-connection observer keeps deletion open until the second connection is checked out. The test requires deletion to succeed, the writer to receive the exact deleted-document conflict, one original history entry, an absent live path, and successful path reuse. Bounded barriers and settlement of both promises ensure a timeout or driver deadlock is a failure, never acceptable evidence of a losing writer.

R3a-4(b) is assigned to **Task 7/R3b for typed provider classification, transaction rollback and SDK/host propagation**, and **Task 9/R4 for editor presentation**. The current classifiers only identify uniqueness and foreign-key failures; lock errors are unclassified and can propagate as driver errors. This scope decision does not claim they are already normalized. Lock conflicts are distinct from revision mismatches; no automatic retry is authorized.

Verification for R3a-4(a): ten consecutive focused runs per provider passed (114 selected tests per run; 195 filtered out). Subsequent full integrations passed without skips: PostgreSQL 357 / 8 files and MySQL 378 / 11 files. Conformance typecheck, scoped Biome, documentation and link checks passed. See [Task 6 evidence](./2026-09-05-stale-document-write-protection-task6.md#r3a-4-follow-up--deterministic-storage-contention) for commands, log paths and check scope.

**Repeat-run policy:** at each remaining checkpoint, run the affected concurrency suites ten consecutive times per provider, with explicit barriers and separate physical connections where contention matters. Preserve every run's result and fail the checkpoint evidence on any failure or timeout; investigate and restart the ten-run series after a correction. Record the exact selection and filtered-out test counts separately from full-suite regression results. Repetition supplements deterministic coordination; it does not prove absence of races. Task 11 includes this policy for final regression.

### R3a — single-document enforcement: passed, 2026-09-05

**Source:** the user's supplied independent reviewer verdict. This entry records that review; the implementing agent did not rerun runtime tests while recording it.

| Criterion | Reviewer outcome |
| --- | --- |
| Atomic Save and one revision advance per changed target | Pass on both providers, including combined saves and rollback. |
| Stale publish and stale SDK replacement | Pass; explicit observed revisions remain required, with no public bypass. |
| Singleton first-save races and duplicate source guard | Pass; source validation and destination creation remain correctly scoped. |
| Single-document schedule suspension/cancellation | Pass; worker and structural integration remain Task 7 scope. |
| Hooks and side effects | Pass; hooks remain outside the final transaction and committed outcomes retain their distinction. |
| Caller compatibility | Pass; affected public callers compile with explicit observations. |
| R3a-1/2/3 | Closed: shared/exclusive registration locks, general lock API and independent-document concurrency proof accepted. Mode selection precedes document locking, with no upgrade path. |
| R3a-4(a) | Closed: deletion holds its locks first, the writer uses a separate physical connection, and only the specific deleted-document conflict satisfies the losing-writer assertion. Bounded barriers and drained promises reject timeout/deadlock false positives. |
| T5-1 | Closed: dedicated suite has six executable tests, zero adapter casts and zero todos, supported by real-adapter maintenance coverage. |

**Independent verification:** MySQL full integration passed ten consecutive runs at 378 tests each. PostgreSQL passed five additional runs at 357 tests each, bringing the reviewer's session total to ten successful runs. The reviewer also reproduced SDK 168, root typecheck 44 tasks, clean Knip, and the 1,216-entry public-export baseline. Repetition corroborates the explicit lock/barrier mechanism; it is not proof of race freedom.

| Open item | Owner / checkpoint |
| --- | --- |
| R3a-4(b): typed lock-conflict classification, confirmed whole-transaction rollback, SDK/host propagation | Task 7 / R3b |
| R3a-4(b): safe editor presentation | Task 9 / R4 |
| R1-1: upgrade-specific suspension reason | Task 7; non-blocking |
| R2-1: adapter-double and unchecked-cast audit | Task 8 / R4 |

The reviewer accepted the R3a-4(b) scope: a distinct error from `ERR_DOCUMENT_STALE`, retry eligibility only after confirmed rollback, no automatic retry, and no conflation with connection loss or uncertain commit outcomes. These error-handling changes remain unimplemented.

**Verdict: pass.** Task 7 is unblocked. R3b must verify collection-first worker execution, document-before-schedule locking, authorized-revision arm/reconfirm/suspend semantics, tree/reorder derived-target revisions including sibling key repairs, self-heal inside the initiating transaction, and R3a-4(b). The ten-repeat policy applies to the affected concurrency suites on each provider. This pass does not claim worker/structural completion or authorize release.

### R3b — scheduler and structural enforcement: passed, 2026-09-05

The reviewing agent reported **pass with no blocking findings**. This record preserves the supplied independent review; it does not claim additional implementation-agent test runs.

| Reviewer criterion | Outcome |
| --- | --- |
| Schedule authorization | Pass. Arm, reschedule and reconfirm store the resulting `authorized_revision` and advance once. Workers use persisted schedule authorization rather than a fresh document observation. |
| Worker/editor lock interactions | Pass. Guarded publication acquires collection, document and then schedule locks. `beforeStatusChange` runs outside the final transaction. |
| Structural targets and revision advances | Pass. Exclusive collection coordination precedes target discovery and sorted document locks. Only stored placement/key changes advance revisions; display-only sibling shifts do not. |
| Affected-schedule summaries | Pass. `scheduledPublicationsNeedReconfirmation` remains separate from structural success. Schedule visibility requires publish and change-status permission; derived receipts require read permission. |
| Claim bookkeeping | Pass. Lease acquisition completes before editorial work; claim, release and backoff do not advance document revisions. A replaced claim leaves its replacement token, state and revision untouched. |
| Controlled races and multi-target rollback | Pass. Twenty-one cases per provider use explicit barriers. A late second-target failure restores deletion, child placement, schedules and earlier revision increments. |
| Public callers and retry policy | Pass. All 44 typecheck tasks pass, with explicit observations and no automatic retry. |

Tree placement self-heal now runs inside the initiating guarded update transaction. Placement failure rolls back the content write, closing the best-effort gap identified at R0.

**R3a-4(b) — server classification, rollback and propagation: closed.** Both transaction managers require transaction ownership, callback failure, identity with the callback error, and a classified lock failure before producing `ERR_LOCK_CONFLICT`. The reviewer accepted this identity check as confirmation that rollback succeeded: rollback failure replaces the error, while commit failure has no callback error. Public details are limited to `{ reason: 'lock_conflict', rolledBack: true, retryable: true }`; driver SQL is excluded. Connection loss and uncertain commit outcomes are not presented as safely retryable. Editor presentation remains Task 9/R4.

**R1-1 — closed.** Both schemas and native upgrades include `upgrade_invalidated`. Incremental migration `0002` relabels only rows with null authorization, `needs_reconfirm` state and `document_metadata_changed` reason. Applied `0001` history remains unchanged.

**Accepted change in migration evidence.** R1's byte-equivalence check is superseded by semantic occupied-fixture equivalence: the consolidated native upgrades (PostgreSQL `0010`, MySQL `0005`) and incremental `0001` plus `0002` run against the same fixtures and `assertUpgrade()` assertions. The reviewer explicitly accepted this evidence basis for the one-file versus two-file paths.

**Independent verification:** PostgreSQL 378 tests, MySQL 399 tests, SDK 169 tests, typecheck 44 tasks, knip clean, export baseline 1,216, and native SQL history 13 unchanged scripts. The reviewer ran **ten full-suite repetitions per provider: 20/20 clean, zero failures**. These full-suite repetitions are additional to the implementer's selected concurrency repeats recorded in Task 7 evidence; repetition supplements deterministic coordination.

| Carried item | Owner |
| --- | --- |
| R2-1: supplemental SDK test-tree typecheck (103 diagnostics), adapter doubles and unchecked casts | Task 8 / R4 |
| R3a-4(b): editor presentation distinguishing safe lock failures, stale documents and committed-hook warnings | Task 9 / R4 |

The supplemental diagnostics remain **not passing evidence**. R4 must verify actual host transport, stale action controls, two-browser-context behavior and mock repair without new unchecked casts.

**Verdict: pass.** Task 7 is complete and reviewed. The user requested committing and pushing this reviewed checkpoint before Tasks 8–9, without DCO sign-off, attribution trailers or a PR. R4 and R5 remain unchecked; this checkpoint does not claim release readiness.

## Progress

- [x] R0: design readiness — Task 1 complete and reviewed; passed 2026-09-05 (see Review records).
- [x] R1: storage foundation — Tasks 2–3 complete and reviewed; passed 2026-09-05 with open non-blocking R1-1 (see Review records).
- [x] R2: read integrity — Task 4 complete and reviewed; passed 2026-09-05 with open non-blocking R2-1 and R2-2 (see Review records).
- [x] R3a: single-document enforcement — Tasks 5–6 complete and reviewed; passed 2026-09-05 (see Review records).
- [x] R3b: scheduler and structural enforcement — Task 7 complete and reviewed; passed 2026-09-05 (see Review records).
- [ ] R4: end-to-end behavior — Tasks 8–9 complete and reviewed.
- [ ] R5: release readiness — Tasks 10–11 complete and reviewed.

R0, R1, and R2 passed; R0-1 was approved by the user on 2026-09-05. Tasks 2–4 are implemented and reviewed. Tasks 5–6 are implemented and verified; R3a requested the narrower collection-lock policy, which the user approved and the reviewer has accepted. R3a passed independent review on 2026-09-05; R3a-4(a) is closed. Task 7 passed independent R3b review on 2026-09-05, including ten full-suite repetitions per provider (20/20 clean). R2-2 is closed by the Task 5 follow-up. R1-1 is closed by R3b; R2-1 remains open for Task 8/R4, including the supplemental test-tree diagnostics recorded in Task 7 evidence. T5-1 is closed by the R3a reviewer. Incremental migrations have run against local test and development databases, with the original development ledger entries preserved; no squash or CLI baseline replacement has occurred. No checkpoint after R3b has been marked passed. R0-2 remains resolved in the read-only facade contract, and R0-3 remains assigned to Task 10/R01.
