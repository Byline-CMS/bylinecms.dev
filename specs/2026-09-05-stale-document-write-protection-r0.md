---
title: "Document revision R0 contracts and review handoff"
path: "document-revision-r0-contracts"
summary: "Define the Task 1 API, editable snapshot, mutation ownership, and lock contracts for review before storage implementation."
---

# Document revision R0 contracts and review handoff

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) contains the populated operation ledger and checkpoints.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the required behavior.
- [Transactions](../docs/03-architecture/03-transactions.md) describes current ambient transaction limits.

Date: 2026-09-05

Status: R0 passed on 2026-09-05. The user approved R0-1; R0-2 and R0-3 are closed with implementation obligations tracked. All signatures below are proposed contracts for implementation, not shipped APIs. No migration, application code, or database has changed in this stage.

## Decisions submitted to R0

Use numeric document revisions, explicit editable-read methods, and provider-owned read-only repeatable-read snapshots. Do not use the plan's revision-bracket fallback initially: both providers already construct query builders from an executor, so an executor-bound facade is a sufficiently narrow extension to implement and test first.

Use one short final mutation transaction with ordered locks and one revision advance per changed document. Preparation and user hooks must not hold those final mutation locks. Runtime checks must prevent user callbacks from reentering a partially applied guarded mutation.

The operation ledger in the plan maps the actual entry points and every mutation family. Its test IDs below name required future tests, not tests executed in Task 1.

## Current implementation facts affecting the design

- `DocumentQueries` in both providers accepts a database executor plus a transaction manager. Most reads use its stored raw `db`, while `getDocumentSystemFieldsForUpdate` explicitly uses the ambient manager. `withTransaction` alone does not make ordinary reads coherent with writes.
- `DocumentPublishScheduleCommands.schedule` and `confirm` lock the document before the schedule. `publishClaimedScheduledDocument` currently locks the claim before rereading document metadata through ordinary queries. The worker must instead acquire the document first and perform its authoritative checks on that locked executor.
- `claimDue` leases schedule rows without acquiring document locks. This is safe as a separate short operational transaction only if it commits/releases those locks before worker execution begins.
- Tree commands acquire the collection row before structural writes. Flat `reorderCollectionDocument` can repair many keys through repeated standalone `setOrderKey` calls before moving the requested document. That whole operation must move into a core-owned transaction.
- Singleton saves hold their slot lock while running preparation and `beforeSave`. Moving preparation out of the final commit transaction is a deliberate implementation change: the final slot/document compare remains authoritative, and competing empty-slot saves can both prepare but only one can commit.
- Create auto-placement and update self-healing currently run after content persistence. They must not become an unguarded second revision-changing write.

These facts were checked in provider `storage-queries.ts`, `storage-commands.ts`, `publish-schedules.ts`, core `scheduled-publish.ts`, `singleton-lifecycle/internals.ts`, and host `collections/reorder.ts`.

## Public input and result contracts

Revision remains an ordinary `number` in TypeScript, validated as a positive safe integer at runtime. Do not brand numbers in a way that requires callers to cast values returned from JSON.

```ts
interface DocumentWritePrecondition {
  expectedRevision: number
}

type SingletonSavePrecondition =
  | { expectedState: 'empty'; expectedRevision?: never }
  | { expectedRevision: number; expectedState?: never }

interface DocumentRevisionReceipt {
  documentId: string
  revision: number
}

interface StructuralMutationReceipt extends DocumentRevisionReceipt {
  affectedDocuments: DocumentRevisionReceipt[]
  scheduledPublicationsNeedReconfirmation: boolean
}
```

Every existing-document core lifecycle parameter object gains required `expectedRevision`. Existing version/locale/path/patch fields remain, except that the loaded admin `versionId` is no longer the concurrency precondition. Core retains `previousVersionId` internally for content carry-forward integrity. Schedule target version IDs and restore source version IDs remain explicit and separate.

Collection SDK changes:

| Method | Required change |
| --- | --- |
| `update(id, data, options)` | Require `options: UpdateOptions & DocumentWritePrecondition`; remove default `{}`. |
| `changeStatus(id, nextStatus, options)` | Add required `DocumentWritePrecondition`. |
| `unpublish(id, options)` / `delete(id, options)` | Add required `DocumentWritePrecondition`. |
| `restoreVersion(id, sourceVersionId, options)` | Add required `DocumentWritePrecondition` for the current target. |
| `schedulePublish(id, options)` / `confirmScheduledPublish(id, options)` | Add required revision alongside existing target constraints. |
| `cancelScheduledPublish(id, options)` | Add required `DocumentWritePrecondition`; return `{ schedule, revision, documentId }` even when schedule is null. |
| `placeTreeNode(id, options)` / `removeFromTree(id, options)` | Require revision in existing options; retain structural neighbor/parent and reconciliation options. |
| `create(data, options)` | No expected revision; return revision 1 for the created document. |

Host-only operations such as duplicate, copy/delete locale, standalone system-field writes, and flat reorder pass required `expectedRevision` to their existing core operation. Introduce one core `saveDocument` operation for combined patches and optional system fields; it owns one transaction, not two existing host calls. Do not add new SDK convenience methods merely to mirror every host operation.

Singleton `update(data, options)` takes existing locale options intersected with `SingletonSavePrecondition`; all its other existing-document mutation methods require `DocumentWritePrecondition`. Core checks the explicit empty expectation under the slot lock; published `get() === null` never establishes slot emptiness. Historical restore and copy cannot create an empty slot.

Version-creating results preserve `documentId` and `documentVersionId` and add `revision`. Status, system-field, delete, and other results preserve their operation-specific data and add `DocumentRevisionReceipt`; methods previously returning void return a receipt. Duplicate returns the new document's receipt plus the observed `sourceRevision` without advancing the unchanged source. Multi-target effects return affected receipts internally; the host must authorize/filter identities before exposing them.

An authorized schedule suspension summary can add visible target IDs and counts to the structural receipt, but hidden targets must not be disclosed. `scheduledPublicationsNeedReconfirmation` supports a generic notice when no target identity can be exposed. Counts must describe visible targets only. The UI then links to authorized schedule review, not automatically to hidden documents.

## Editable-read contracts

Add dedicated methods without changing ordinary published/historical defaults:

```ts
interface EditableDocument<F> extends ClientDocument<F> {
  revision: number
  scheduledPublication: DocumentPublishScheduleInfo | null
}

type EditableSingleton<F> =
  | { state: 'empty' }
  | { state: 'document'; document: Omit<EditableDocument<F>, 'path'> }

// CollectionHandle
findByIdForEdit(id, options?): Promise<EditableDocument<TFields> | null>
findForEdit(options?): Promise<EditableFindResult<TFields>>

// SingletonHandle
getForEdit(options?): Promise<EditableSingleton<TFields> | null>
```

The `EditableFindResult<F>` result is `{ docs: EditableDocument<F>[], meta: FindResult<F>['meta'] }`, named `EditableFindResult<F>`. Current `FindResult<F>` remains unchanged. Full document edit reads do not accept a historical version or published-only selector. They require the same `readMode: 'any'` authorization and row scoping as current admin reads. `getForEdit` returns `state: 'empty'` only after authorized access to a genuinely unmapped slot. Hidden/deleted/inconsistent mapping returns null or the existing authorized unavailable error, never “empty.”

Ordinary `ClientDocument` and history/published responses do not gain `revision`. Raw storage may project it for internal use, but response shaping must drop it outside dedicated editable methods. A caller may later become stale after a coherent edit read; that is expected, and the write guard catches it. The revision is an observation, not authorization or a promise of future freshness.

List edit reads return selected row fields plus coherent source metadata/revision; these observations authorize a specific document action, not full replacement based on omitted fields. Tree action reads use an explicit edit variant of the existing tree read path, with snapshot-consistent topology and per-node revisions. Retain existing neighbor validation at write time. Do not mint a token by separately reading the current document after showing a historic/list snapshot to the editor.

### Adapter snapshot capability

Add a provider-neutral capability with a query-only callback:

```ts
interface ReadSnapshotQueries {
  collections: ICollectionQueries
  documents: Omit<IDocumentQueries, 'getDocumentSystemFieldsForUpdate'>
  audit: IAuditQueries
  singletons: ISingletonQueries
}

withReadSnapshot<T>(fn: (queries: ReadSnapshotQueries) => Promise<T>): Promise<T>
```

The snapshot facade excludes `getDocumentSystemFieldsForUpdate` at both type and runtime: construct a read-only facade rather than casting the complete queries object. Do not expose `SELECT … FOR UPDATE`, mutation helpers, or an ambient write-manager escape through it. Audit the remaining methods and nested `publishSchedules` query surface for read-only behavior; any future locking query must be excluded too. Test the type exclusion and the runtime facade, including JavaScript callers.

Each adapter opens a read-only repeatable-read transaction and constructs its query facade against that transaction's executor, including schedule and singleton mapping queries. The facade must not escape its callback. Existing public query objects continue using the pool. Do not expose transaction handles or Drizzle types to core.

Core/client resolves authorization and before-read predicates before opening this snapshot, then uses the scoped queries to assemble raw source fields, source metadata, and action state. End the snapshot before arbitrary `afterRead` hooks and related-document population run. Those retain their existing scoping/redaction semantics; no cross-document snapshot guarantee is added. Preserve the captured source revision and identity as reserved metadata through response shaping. An after-read hook that changes another persisted document may make the source stale afterward, but cannot substitute a newer revision into the captured source.

Snapshot callbacks contain only controlled read assembly. Do not run user mutations in the read-only transaction or retry user hooks on serialization errors. Failed snapshot reads return no editable result. The revision-bracket fallback remains available only through the plan's explicit reviewer decision if facade construction proves insufficient; it is not selected at R0.

## Error contract

`ERR_DOCUMENT_STALE` has a typed discriminated details union:

| Reason | Required fields |
| --- | --- |
| `revision_mismatch` | `documentId`, `expectedRevision`, `currentRevision` |
| `version_parent_mismatch` | `documentId`, `previousVersionId`, `currentVersionId` (string or null) |
| `singleton_slot_changed` | `singletonPath`, `expectedState: 'empty'`, `currentState: 'document'` |

Missing and invalid revision errors use the typed `ERR_VALIDATION` reasons in the spec. A malformed empty-slot union is validation, not staleness. Hidden/deleted resources keep authorized unavailable behavior. Runtime decoders whitelist fields and validate safe numbers; never expose raw database errors or infer these variants from English strings.

Low-level parent `reason: 'stale'` normalizes at the lifecycle boundary only. Unrelated `ERR_CONFLICT` values do not. Committed hook failure details add the committed revision; delete keeps its committed-with-side-effect-failures outcome. An editor must distinguish an uncommitted stale rejection from a saved result whose hook failed.

## Final mutation boundary and lock order

Use the existing `withTransaction`/audit boundary, with private core coordination and adapter primitives that act on its ambient executor. A locked authoritative snapshot includes document identity, collection, revision, current content version/status, path/locales, and liveness; read it through controlled transaction-scoped queries rather than the raw pool. Existing content parent checks remain defense in depth.

The private coordinator records changed targets and advances each once before commit. Standalone internal storage mutations must also invalidate revisions: they either own this scope or join an existing scope. Do not implement low-level commands that silently omit advancement whenever a public service forgets to pass a flag. A private scope records each target's first revision and final mutation state; repeated writes in that scope do not create extra increments. Rejected transactions discard the scope. Raw SQL remains an operator responsibility, not a concurrency-safe application API.

**R3a amendment, user-approved 2026-09-05:** The ordinary-write and worker exceptions below are superseded by the [Task 6 lock refinement](./2026-09-05-stale-document-write-protection-task6.md#lock-order-refinement-for-r3a). Ordinary flat writes now acquire a shared collection registration lock before document locks because version/path/audit inserts can acquire collection foreign-key locks. Deletion, maintenance, trees and singleton coordination retain exclusive collection locks, selected before document locks without upgrades. Task 7 must apply the same collection-first discipline to worker execution; schedule-only claim leasing remains separate. The following text preserves the original R0 decision for review history.

Lock order for final mutation transactions:

1. Collection structural rows, sorted by collection identity, when creation/placement/reorder/deletion can change membership or order.
2. Singleton slot rows, where applicable. The current slot lock may be the same collection row; acquire it once.
3. Existing document rows, sorted by document identity. Revalidate target membership/liveness after locking. New records created inside the transaction are not externally visible competitors.
4. Schedule rows for affected documents, sorted by document identity.

Ordinary content/status changes outside tree self-heal do not need a collection lock. Tree collection saves that may self-heal acquire the collection lock first, even when final inspection finds placement already valid. A worker needs document then schedule; it does not take a structural lock merely to publish. Claim leasing is a standalone schedule-only transaction that finishes before execution acquires document locks. Retry/release claim bookkeeping must never acquire documents while holding schedule locks.

Structural operations determine the changed target set while holding the structural collection lock. Lock affected documents before any mutation or schedule row. A changed stored placement/key counts as a revision-changing effect, including sibling key repairs; rows merely read as unchanged neighbors do not advance. Locking unchanged neighbors needed for structural assertions is permitted. No post-commit self-heal may mutate structure without starting another explicit guarded operation. Prefer including automatic placement/self-heal in the initiating transaction so one save produces one revision; review any change to current best-effort failure reporting at R3b.

Delete/promotion locks the deleted document plus changed children/siblings before touching schedules or tombstones. Duplication locks its observed source and any existing structural targets before creating the destination. Batch re-anchor remains per-target transactional, as currently documented: supply an observed revision for every target and report per-target outcomes. It must not silently retry a stale target; it is not a promised all-or-nothing bulk edit. Explicit atomic multi-target structural actions remain all-or-nothing.

### Preparation, hooks, and outer transactions

Perform an authorized preflight snapshot/check before expensive preparation. Run mutation before-hooks once against that observed state, without final mutation locks held. Allocate counters/prepare external uploads according to existing semantics, then recheck the revision under the final locks. If another writer commits during preparation, reject without replaying preparation. Counter gaps and unattached prepared uploads are possible external effects; a stale result must not claim those constitute a document save.

For an empty singleton, preflight observes the slot, preparation runs once, and final commit locks/rechecks the empty slot. This removes user hooks from the slot-lock interval while retaining one successful materialization. A nested write from a before-hook can make the outer request stale; that is a conflict, not an instruction to adopt the nested write's token. Run no arbitrary user hooks inside the final guarded transaction; internal callbacks there may only perform the predeclared storage/audit/schedule work.

**R0 decision requiring explicit reviewer attention:** public lifecycle calls must own their outermost final mutation boundary. Propose rejecting entry from an already-active external adapter transaction with an actionable validation error, while private internal composition joins the coordinator. Existing raw `withTransaction` command composition remains supported. This is a deliberate compatibility restriction to avoid after-hooks firing before an external commit and to prevent callers holding arbitrary locks from defeating the defined order. If preserving public lifecycle-in-external-transaction behavior is required, return that compatibility decision to the user and design commit callbacks/lock-scope propagation before Task 2; do not silently run hooks before the true outer commit. No such nesting guard is implemented in Task 1.

## R0 review disposition

The reviewing agent passed all seven design criteria. The user subsequently approved R0-1 and explicitly closed R0-2/R0-3; Task 2 is unblocked.

### R0-1 — External transactions and media regeneration

Verified affected files:

- `packages/cli/src/templates/byline-examples/scripts/regenerate-media-operation.ts`
- `apps/webapp/byline/scripts/regenerate-media-operation.ts`
- Their respective `regenerate-media.ts` callers and the webapp operation tests.

Both helpers call `handle.update()` inside `db.withTransaction`, then directly restore the captured status, archive other published versions when necessary, and append audit. Their callers pass `doc.status`, so the real operation preserves the status observed before image processing. Replacing this with ordinary `changeStatus` is not equivalent because maintenance does not follow the editorial transition sequence.

**Approved decision (2026-09-05):** adopt the external-transaction restriction and replace this composition with a core-owned maintenance operation:

```ts
replaceDocumentFieldsPreservingStatus(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    data: Record<string, unknown>
    expectedRevision: number
  }
): Promise<CreateDocumentResult & { revision: number }>
```

The name is proposed for the maintenance surface; it does not add an ordinary host status-override endpoint. The operation owns the transaction and requires explicit maintenance authorization, normal update authorization, and the publish ability when preserving a published state. It compares the revision captured before regeneration, derives status from the matching locked document state, and validates that status is still declared by the collection. It never accepts an arbitrary `targetStatus` or substitutes a fresh revision for an old observation.

Create the new version, restore/preserve that captured status, apply published-version archival where applicable, emit no `document.status.changed` audit because the observed status is preserved, suspend any armed schedule, and advance revision once in one commit. Invoke lifecycle preparation and content hooks with the same sequencing guarantees as guarded updates; after-hooks run after the true commit. A concurrent content or status change rejects the maintenance result without altering the document. External image preparation remains outside database atomicity, as already documented. No transient draft or intermediate published state may be visible.

Update both helpers and their callers to use an explicit editable read before processing. Update copied-script upgrade guidance: new packages cannot rewrite helpers already installed in downstream apps. Preserve arbitrary declared observed statuses, including archived or custom workflow states, without adding a general workflow bypass. Include stale-after-processing, published archival, custom-status preservation, audit rollback, one revision advance, and post-commit hook tests.

The user approved this compatibility change and replacement path. Preserve the archive step for an observed published status so the superseded version is archived. Deliberately remove the old default-status-to-observed-status audit artifact: no editorial status transition occurred. Keep appropriate content/audit bookkeeping and rollback tests without fabricating a status change.

### R0-2 — Read-only facade

Resolved in the contract above: explicitly exclude the locking system-fields method, construct a runtime read-only facade, and test exclusion. Carry its implementation/tests into R1/R2.

### R0-3 — Copied template equivalence

Verified the two operation helpers currently differ in import ordering. Task 10/R01 must enforce identical normalized source for the shared helper, or document and test an explicit allowed divergence. Prefer formatting both identically and asserting exact source equality for this helper. Test the executable callers separately where app-specific imports require differences; do not use a broad text-normalization rule that could hide behavioral drift.

## Scheduler details to preserve through implementation

The final arming/reconfirmation transaction compares the caller revision, calculates the next revision, stores it as the schedule's authorized revision, and advances the document once. Ordinary content/metadata mutation plus suspension also advances once. A no-op does not advance and cannot accept an old token.

Worker execution first acquires the document, then checks/locks the still-owned armed schedule, compares its authorized revision and target version, validates the transition, and publishes/finalizes atomically. Preflight before-hooks must be followed by that final check. Schedule-only claim fields do not affect the editorial revision; mismatch handling cannot refresh authorization. Unexpected still-owned armed mismatch suspends for reconfirmation with its own single document revision advance.

## Migration workflow recorded from the user

During development, generate and apply incremental Drizzle migrations to the development/test databases. Add separate plain numbered SQL upgrades in each provider's `sql/` directory for downstream applications; the streams remain independent.

After the implementation/migration review, squash the development Drizzle migration chain into a single fresh-install file, reconcile the explicitly identified development databases' Drizzle migration bookkeeping to that baseline, and use that single baseline in the CLI migration templates. Preserve schema/data and check the bookkeeping against the exact generated baseline; do not truncate content, apply a fresh baseline over an occupied database, or modify downstream migration tables. Keep released native SQL history unchanged.

Task 3 owns development migrations and downstream SQL; Task 10 owns the reviewed squash, dev bookkeeping reconciliation, and CLI final baseline. The final baseline/artifact tests run again after squashing. No development database migration table is edited at R0.

## Test IDs referenced by the ledger

Tests will be added in their corresponding implementation tasks. IDs are stable review labels, not claims of existing test functions.

| ID | Proposed home | Required evidence |
| --- | --- | --- |
| C01 | Core revision/error node tests | Safe numbers, missing input, typed stale decoding, parent normalization. |
| D01 | Shared `document-revisions` conformance suite | Atomic revision advance, current/stale/no-op, rollback, both providers. |
| D02 | Shared `editable-snapshots` conformance suite | Controlled concurrent content/metadata update during assembly; no mixed result. |
| L01 | Core lifecycle tests plus shared document revision suite | Atomic combined save and one increment; preparation/hook boundaries. |
| L02 | Shared operation matrix plus core tests | Status/unpublish/delete/restore/copy/duplicate/current-vs-stale coverage. |
| S01 | Shared singleton lifecycle suite | Empty-slot race, populated stale save, hidden mapping not empty. |
| P01 | Shared publish-schedules suite | Arm/reconfirm self-consistency, metadata suspension, worker/document lock races. |
| T01 | Shared tree/reorder conformance | Derived targets, gap checks, sorted locks, repairs, suspension summaries. |
| M01 | Provider migrations and PostgreSQL locale tests | Backfill/idempotence/resume, re-anchor observations, no startup churn. |
| A01 | Client type/unit/integration tests | Required options, editable methods, published/history no token, explicit source observations. |
| H01 | Host server-function tests | Raw malformed/old payloads; numeric/error/committed-receipt transport. |
| U01 | Admin/host jsdom and two-context Playwright | Persistent warning, all actions disabled, explicit reload/discard, schedule notice. |
| R01 | CLI template/artifact and release checks | Copied re-anchor example, fresh baseline equivalence, native SQL preservation. |

## R0 handoff and stop condition

Task 1 artifacts are this contract note and the populated plan ledger. The most consequential review points are the dedicated editable read facade, worker lock-order conversion, singleton preparation timing, private revision ownership for raw/internal commands, and the proposed restriction on lifecycle entry from external transactions.

Validation at R0 is documentation/reference validation only; no executable behavior has changed and no concurrency tests are claimed as run. The reviewer must record pass or requested changes before Task 2/3 begins. Any proposed compatibility restriction not covered by the approved spec requires a user decision before implementation. R0 is not marked passed by the implementing agent.

Validation record, 2026-09-05:

- `pnpm docs:check`: blocked by the tsx CLI's sandbox IPC `EPERM` before document checking.
- From `apps/webapp`, `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'`: passed, 69 documents and 692 links.
- `git diff --check`: passed. Because these spec files are untracked, an additional direct check validated matching title/H1, trailing whitespace, final newlines, and relative links in all three documents; passed.
- Coverage ledger: 28 operation rows populated, with future test destinations identified.
- Runtime unit, integration, and browser tests: not run; this checkpoint changes only design documents. No source code or migration is claimed as implemented.
- Reviewer verdict: pass; R0-1 approved by the user on 2026-09-05. R0-2 is resolved in this revised contract and R0-3 is assigned to Task 10. Source artifacts are the current uncommitted plan and R0 note; no implementation commit was created.
