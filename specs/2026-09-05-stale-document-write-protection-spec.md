---
title: "Stale document write protection"
path: "stale-document-write-protection-spec"
summary: "Propose consistent revision checks and stale-document warnings for all editorial document mutations."
---

# Stale document write protection

Companions:

- [Document storage](../docs/03-architecture/01-document-storage.md) explains document identity, immutable content versions, and mutable metadata.
- [Transactions](../docs/03-architecture/03-transactions.md) explains the adapter transaction boundary.
- [Scheduled publication](../docs/11-scheduling/02-scheduled-publication.md) describes publication targets and reconfirmation.
- [Singleton documents](../docs/04-collections/09-singletons.md) describes the singleton slot and first-save behavior.

Date: 2026-09-05

Status: approved for implementation planning on 2026-09-05; not implemented. The user authorized a task-based implementation plan after two review rounds. Implementation has not started.

Review revision: the first review supported the core proposal and requested clearer error typing, simpler number serialization, an explicit schedule policy, maintenance/upload coverage, and an enforceable rollout procedure. Those decisions are incorporated below.

Second review: the reviewer verified the revisions and considered the spec ready for approval. The additional copied-template, migration, notification, and verification clarifications are incorporated below and included in the approved scope.

## Problem and intended outcome

Byline serves installations with small editorial teams and substantial cacheable read traffic. Two editors can nevertheless open the same document and make conflicting changes. This specification defines how Byline should reject changes based on an outdated document and explain the rejection to editors and SDK callers.

An editor or SDK caller must supply the revision of the document they observed. If that revision is no longer current, no part of the requested editorial mutation may commit. This applies to content, document metadata, workflow actions, and other document mutations described below.

The initial recovery is deliberately limited: warn the editor and let them reload, discarding their unsaved changes. Automatic merging, preservation across reload, and collaborative editing are outside this work.

## Current behavior verified in the repository

The standard admin content-save handler sends the loaded `versionId` to `updateDocumentWithPatches`. Core compares it with the current content version before applying patches. Both database adapters also lock the document row and validate `previousVersionId` during version insertion, closing the race between the initial read and the write.

The guarantee is incomplete elsewhere:

| Surface | Current limitation |
| --- | --- |
| Admin content conflict | The form retains changes but presents a generic update failure. |
| Path and advertised locales | Writes are serialized and audited, but do not check the revision the editor observed. |
| Combined admin Save | System fields commit first in a separate request; a subsequent content conflict does not undo them. |
| Ordinary status change | The server selects the current version without checking the version displayed by the caller. |
| Collection SDK `update()` | Full replacement accepts no caller-observed version; fetching the latest parent during execution does not establish that the caller saw it. |
| Singleton update | An optional `expectedVersionId` protects content but does not express all metadata changes. |

Implementation references, relative to the repository root:

- `packages/host-tanstack-start/src/admin-shell/collections/edit.tsx`
- `packages/host-tanstack-start/src/server-fns/collections/update.ts`
- `packages/admin/src/forms/form-renderer.tsx`
- `packages/client/src/collection-handle.ts` and `packages/client/src/types.ts`
- `packages/core/src/services/document-lifecycle/`
- `packages/core/src/services/singleton-lifecycle/`
- `packages/core/src/storage/document-version-parent.ts`
- `packages/db-postgres/src/modules/storage/storage-commands.ts`
- `packages/db-mysql/src/modules/storage/storage-commands.ts`

## Document revision

A **content version** identifies one immutable content snapshot. A **document revision** identifies the document's current editorial state, including metadata that can change without creating a content version. A **stale caller** supplies a document revision that differs from the current persisted revision.

Content version IDs alone cannot enforce the requested guarantee. Publishing, changing a path, and changing advertised locales currently leave the content version ID unchanged. Timestamps are also unsuitable as the concurrency contract because precision and representation vary across providers.

Proposed contract:

- Persist a monotonically increasing integer `revision` on the logical document row in `byline_documents`, separate from `byline_document_versions`. Start at 1 and increment by 1 atomically; never reset it or derive it from the number of content versions.
- Use a database `BIGINT` constrained to the range 1 through `Number.MAX_SAFE_INTEGER` (9007199254740991), and expose `revision` and `expectedRevision` as plain JavaScript numbers. Validate positive safe integers at the runtime boundary and normalize driver values with a checked conversion. Clients round-trip the observed value; only the database advances it. Fail rather than wrap or lose precision at the bound. This avoids string handling throughout the SDK for a counter whose safe-number capacity far exceeds the expected workload.
- Every committed editorial state change increments the counter atomically with that change. Creating a document establishes revision 1. For example, saving content can move revision 1 to 2, publishing that same content version moves it to 3, and changing its path moves it to 4 without creating another content version.
- Content saves, status changes, metadata changes, schedule changes, and structural changes all advance the revision. A metadata-only write still creates no content version and does not reset workflow status.
- A single logical mutation advances each affected document's revision once, even if it performs multiple internal writes. Failed transactions leave revisions unchanged.
- A genuine no-op with a current token may return the unchanged revision. A stale token must be rejected even when the submitted value happens to equal the current value.
- Restoring old content creates a new revision; it never reinstates an old revision token. Soft deletion and supported restoration also advance it.
- Locale edits share the same document revision. Independent field and locale changes still conflict; there is no field-level merging.

Correctness requires equality and non-reuse, not ordering. Incrementing an integer is chosen for simple database updates and readable diagnostics. A revision difference measures committed revision advances, not a count of content versions, audit rows, or human edits. No “N changes behind” interface is required in this work.

## Reads and snapshot integrity

Authenticated current-document reads used for editing must return the content, editable metadata, and revision from a consistent database snapshot. A response must never attach a newer revision to older content or metadata. This includes admin loaders, SDK reads used to prepare writes, singleton reads, and list/tree rows that expose mutation controls.

Successful mutations return the committed revision and, when applicable, the new content version ID. The admin interface may use a coherent refetch to establish its next editing baseline. It must not update only its token while retaining an older editable snapshot.

A published or historical content view is not necessarily the current editable document. It must not supply a usable current write token alongside older content. Such responses must explicitly lack a current write precondition, or require a separate authenticated current-document read before mutation. Preserve existing public published-read defaults; do not silently change them to make SDK writes convenient.

The implementation plan must identify how each adapter provides coherent edit snapshots and how client response types distinguish editable current reads from historical/published reads. Public reads should not require locks, polling, or additional write-related round trips. Revision tokens are not credentials and never replace authorization.

## Required mutation coverage

All supported admin, host, SDK, and public core lifecycle entry points that act on an existing document must require an explicit observed revision, without an ordinary caller bypass.

| Operation | Required precondition and effect |
| --- | --- |
| Full replacement or patches | Check the target revision; commit a new content version and revision together. |
| Path or advertised locales | Check the target revision; commit metadata, audit, and revision together. |
| Combined content and metadata Save | Check once at the shared commit boundary; commit all requested changes or none. |
| Status change or unpublish | Check the target revision before resolving and mutating the authorized current state. Never act on unseen newer content. |
| Schedule, reconfirm, or cancel publication | Check the document revision as well as existing publication-target and schedule constraints. |
| Delete document or delete locale | Check the target revision; commit deletion, related audit/schedule changes, and revision changes atomically. |
| Restore a historical content version | Check the current target document revision separately from the historical source version ID. |
| Copy to locale | Check the document revision before reading the source and committing the destination locale. |
| Duplicate | Check the source document revision before creating a copy. Do not duplicate newer source content unseen by the caller. A successful copy creates its own revision and does not change the source revision unless it actually changes the source. |
| Tree placement, removal, or ordering | Check the initiating document revision and existing structural preconditions. Advance revisions of documents whose editorial structure actually changes. |
| Singleton mutations | Apply the same rule, including status, schedules, restore, and locale copy. |
| Upload attached to an existing document | The field widget's upload preparation does not mutate the document; attaching the returned stored-file value is covered by the guarded patch/update. Any endpoint that directly replaces a persisted field must itself require the revision. |
| Standalone upload creating a document | Treat as ordinary new-document creation and return its initial revision. No existing-document revision is required. |
| Explicit source-locale re-anchor | Cover the PostgreSQL maintenance APIs `reAnchorDocument` and `reAnchorDocuments`: require an observed revision per target for actual changes, validate under the document lock, and advance revisions atomically with re-anchoring. Dry runs do not advance revisions. No new MySQL re-anchor API is required. |
| Boot-time source-locale backfill | Preserve the narrow normalization exception described below; it is not an unconditional re-anchor operation. |

Creating a new ordinary document has no existing-document precondition. First save of an empty singleton must instead require an explicit expectation that the registered slot is empty, checked under the slot lock. Omission must not mean either “empty” or “unconditional.” Two saves based on the same empty slot allow one creation and reject the other as stale.

For multi-document tree/order operations, lock affected records in a consistent order, retain neighbor/group validation, and reject stale submitted structural expectations before any write. Every explicitly edited existing target in a bulk request must have a caller-supplied revision. Children promoted by deletion and siblings whose order is changed as a consequence are transactionally derived effects: advance their revisions so their open editors become stale. Do not require clients to fabricate observations of records they never loaded. The implementation plan must inventory these affected sets and lock ordering, including the direct reorder server function.

Search indexing, analytics ingestion, cache invalidation, and scheduler claim bookkeeping are not editorial document changes. They do not advance document revisions solely for operational activity. A scheduler's actual publication or editorial schedule-state change does advance the revision. Low-level migrations and maintenance remain internal storage operations, not an SDK opt-out; any maintenance operation changing editorial state must also invalidate existing revisions.

`backfillSourceLocales()` currently updates only rows whose `source_locale` is NULL and stamps the configured fallback already used to interpret those rows. `initBylineCore()` calls it before serving requests, and it updates zero rows on subsequent boots once all rows are stamped. This exact operation may leave revisions unchanged when it preserves the effective source locale. It must not overwrite existing anchors or be used to reinterpret documents after a default-locale change. Such a change requires explicit re-anchoring and revision advancement. Upgrade instructions must establish the historical fallback before this one-time normalization; if preservation cannot be established, require maintenance reconciliation rather than silently applying the exception. A deploy must not invalidate every editor merely because startup ran again.

## Atomic enforcement

Authorization remains mandatory. After authorization, the server validates the precondition and compares it with persisted state under the same transaction and document lock used to commit the mutation. A check followed by a later unguarded write is insufficient. Existing content parent checks remain in force.

With two requests using revision R1, at most one state-changing request can commit. After that commit produces R2, the other must receive a stale-document conflict. This must hold across processes and app instances for PostgreSQL and MySQL, without an in-memory mutex or edit-session lease.

The admin Save path must become one logical core operation and transaction when both content and system fields are dirty. Revision changes, content insertion, path/locales, audit entries, and schedule suspension must all commit or roll back together. Sequential host calls, even when passing the first call's new revision into the second, do not meet this contract.

Extend or refactor the existing `commitContentVersionWithScheduleSuspension` boundary in `packages/core/src/services/document-lifecycle/publish-schedule-consistency.ts`. It already wraps a version write, schedule suspension, and audit in `audit.withTransaction`; `persistence.ts` routes existing-document content writes through it. Reuse that transaction model rather than introducing a competing orchestration path.

Error precedence is deliberate: authorization and precondition validation come first, then the locked revision comparison. For a current revision, validate/write the requested path before inserting the new content version, preserving the existing rationale that a path conflict surfaces before version insertion. The path write must now be inside the shared transaction, so later failure rolls it back. A stale request reports staleness before path uniqueness, and this ordering does not replace the database uniqueness constraint.

Hooks and uploads require explicit sequencing:

- Detect an already-stale request before running mutation hooks, allocating counters, or starting upload persistence where feasible.
- Any preparation outside the commit transaction must be followed by an authoritative revision check inside it. Hooks must not be silently retried after a conflict.
- Post-commit hooks run only after the complete mutation commits. A rejected stale mutation emits no success hook, success audit, or search/cache reconciliation for that mutation.
- Database rollback cannot undo an external upload or arbitrary side effect in a before-hook. The plan must identify these boundaries and avoid claiming distributed atomicity. Preflight upload checks alone do not replace the final guarded document commit; unpublished upload preparation must never be reported as a saved document.
- Existing committed-hook-failure reporting must remain distinguishable from stale rejection and include the committed revision where reconciliation needs it. A committed save with a failed after-hook must not tell the editor that nothing saved.

## SDK and error contract

Require `expectedRevision` in TypeScript and validate it at runtime on all applicable entry points. Ordinary SDK and lifecycle code must not fetch a fresh token and substitute it for an omitted or stale caller token. The supplied token must represent the state used to prepare the mutation.

This is a breaking API change. Existing `expectedVersionId` and `documentVersionId` preconditions must be migrated or retained only as additional constraints; they cannot silently substitute for a document revision. Historical source-version IDs and scheduled publication target-version IDs remain distinct concepts.

Use a transport-safe domain error with a stable machine-readable discriminator:

- Introduce a dedicated `ERR_DOCUMENT_STALE` code for the supported editorial stale-write contract. Export a typed details union with reasons `'revision_mismatch'`, `'version_parent_mismatch'`, and `'singleton_slot_changed'`. Each variant defines its required identity and expected/current-state fields; do not infer the error from an arbitrary `details.reason` on `ERR_CONFLICT`.
- The existing adapter-level `DocumentVersionParentConflictReason = 'missing' | 'stale'` is already typed and remains a separate low-level integrity contract. Supported lifecycle boundaries translate a stale parent into `ERR_DOCUMENT_STALE` with reason `'version_parent_mismatch'` if it reaches them; missing parents remain validation/integrity failures, not evidence that the editor is stale. Raw adapter callers can continue receiving the existing parent conflict. Other tree, path, and workflow conflicts must not be reclassified indiscriminately.
- Authorized diagnostic details identify the document and the expected/current revision or version IDs appropriate to that variant. They contain no field content. Returning the current token is diagnostic information, not permission to replay the old payload with it.
- Missing or malformed revision preconditions produce `ERR_VALIDATION` with a typed details union using reasons `'missing_document_revision'` and `'invalid_document_revision'`. Never allow the operation through. Define and export runtime guards/decoders for these contracts; a type assertion on serialized input is insufficient.
- Deleted/unavailable documents may return the existing authorized not-found outcome; the admin must present a specific unavailable/reload message rather than a generic network error. Do not leak hidden document existence through conflict diagnostics.
- Host serialization and client helpers must preserve the discriminator without parsing English error messages. Tests must exercise the server-function boundary, not only direct core exceptions.

The plan must list changed signatures and all first-party call sites, including seeds, tests, automation, and custom host integrations. If an operation has no preceding read today, introduce an explicit read/prepare step rather than manufacturing freshness inside the mutation.

Include scripts already copied into downstream repositories by the CLI. In particular, `packages/cli/src/templates/dialects/postgres/byline-examples/scripts/re-anchor.ts` currently calls `db.reAnchorDocuments({ targetLocale, collectionId, dryRun })`. Update the template and provide an upgrade example for existing generated copies that reads and submits each target's observed revision. Publishing updated packages does not update those copies, and database access fencing cannot identify outdated script source. The downstream upgrade checklist must name this manual call-site audit.

## Admin warning and recovery

For a stale rejection, show a persistent warning near the document actions, optionally accompanied by a toast:

> This document has changed since you opened it. Your changes were not saved. Reload the document to continue. Reloading will discard your unsaved changes.

Provide an explicit **Reload document** action. Do not automatically reload, clear local fields, replay patches, or replace the expected revision after a conflict. The editor may inspect or copy unsaved text before reloading. Block further mutation controls for this stale editing session until it reloads, including Save, publish/status, metadata, schedules, delete, duplicate, locale operations, and structural actions exposed there.

Reload must fetch current authorized state from the server, reset fields, pending patches, dirty state, metadata, and revision together, and clear the warning. If the document has been deleted or access removed, show the appropriate unavailable state. Reload is an explicit discard action and must state its effect; ordinary navigation guards remain active otherwise.

List and tree actions need the same specific stale warning and a refresh path for the affected view. Translate messages through the existing admin i18n system. Preserve accessible announcement and keyboard access. No compare/merge interface is required in this scope.

A successful reorder or other structural mutation that suspends publication schedules must also notify the editor; silent suspension is not accepted. The result must distinguish successful structural changes from any post-commit hook failure and report schedule suspensions caused by that operation, including derived sibling/child effects. Show a message such as “Order updated. Scheduled publications now require reconfirmation,” with an authorized way to find and review the affected schedules. Include affected identities/counts only where the actor may view them; otherwise give a generic notice without disclosing hidden documents. Do not imply that the reorder failed or automatically reconfirm publications. This notice is separate from a stale-write rejection.

## Scheduler integration

Scheduled publication is a previously authorized future operation, not an unattended caller that may publish any current version. Preserve the existing target-version, claim ownership, reconfirmation, and authorization checks.

Metadata-only changes must suspend an armed schedule. Publishing automatically after an unseen path, locale-advertising, or structure change would contradict the document-wide freshness rule. The current `suspendForContentEdit` behavior already changes an armed schedule to `needs_reconfirm` with reason `'content_edited'`; generalize this behavior as follows:

| Event | Schedule and revision behavior |
| --- | --- |
| Arm, reschedule, or reconfirm | Validate the caller's document revision and target content version. Commit the armed schedule with the document's next revision stored as its authorized revision, so arming does not invalidate itself. |
| Content change, including locale changes and historical restore | Change `armed` to `needs_reconfirm` in the same mutation; retain reason `'content_edited'`. |
| Path, advertised locales, source-locale re-anchor, or actual structural change | Change `armed` to `needs_reconfirm` in the same mutation, using a typed reason such as `'document_metadata_changed'`. This includes affected structural documents with armed schedules. |
| Explicit status change, unpublish, or document deletion | Preserve the existing transactional cancellation behavior and reason. |
| Edit while already `needs_reconfirm` | Leave the schedule suspended; advance the document revision for the edit without silently updating the previous authorization. |
| Pure no-op or operational claim/lease bookkeeping | Do not advance the document revision or invalidate authorization. |
| Worker publication | Under the document lock, validate the armed state, claim ownership, authorized revision, target content version, and current authorization/workflow constraints. Publish and finalize the schedule atomically with one document revision advance. |

Suspension and its triggering mutation advance the document revision once, not once per internal write. Reconfirmation uses a fresh current-document read and records the resulting revision as the new authorization. It may intentionally authorize a new current content version under existing reconfirmation rules.

On an unexpected authorized-revision mismatch, the worker must not publish or replace its expected revision with the current one. If it still owns the armed schedule, atomically suspend it for reconfirmation and audit that transition; otherwise respect the existing claim-lost/cancelled state. Claim ownership must be rechecked after acquiring locks. Do not add a general “system actor bypasses concurrency” rule. The plan chooses concrete types and lock ordering for this specified policy, rather than deferring the policy itself.

## Compatibility and rollout

Both providers require native existing-installation upgrade scripts in `packages/db-postgres/sql/` and `packages/db-mysql/sql/`, updated squashed/fresh baselines in their database migrations, and synchronized CLI migration templates in `packages/cli/src/templates/migrations/` for the relevant dialects. Backfill existing document rows to revision 1; no historical mutation count needs to be reconstructed. Counters are scoped to document identity, so two documents can both have revision 1. A document's counter must never reset, including after soft deletion or restoration.

The PostgreSQL source-locale migrations provide a local precedent: `0001_upgrade-2.7.0-to-3.0.sql` adds a nullable column, application startup backfills it, and `0002_set-source-locale-not-null.sql` checks completeness before tightening the constraint. For revision, the fenced maintenance window permits add-nullable, backfill, and constraint enforcement in one upgrade script, with provider-appropriate handling of DDL transaction behavior. The PostgreSQL and MySQL upgrade streams are numbered independently (currently ending at 0009 and 0004 respectively); choose each next available number at implementation time rather than requiring matching numbers.

Use a non-null revision column without a persistent default; upgraded creation code explicitly inserts 1. This helps reject old inserts but does not stop old updates to versions, paths, or other tables. A column constraint alone cannot enforce this rollout.

The supported first rollout is a maintenance cutover, not a rolling mixed-writer deployment:

1. Pause editorial traffic and all document-writing jobs, including schedulers, importers, and external SDK integrations.
2. Fence old writer database access: revoke the old application writer credentials/privileges and terminate existing writer sessions. Provision a replacement writer principal or credentials available only to the upgraded deployment. Where the old principal owns schema objects, use an operator-controlled cutover that removes that access as well; changing its password alone does not terminate established sessions. Keep a separate migration/operator connection.
3. Run both the applicable upgrade and backfill, then deploy a compatible set of core/client/provider/host packages and update every writer integration. Existing armed schedules without a trustworthy authorized revision must migrate to `needs_reconfirm`; do not retroactively authorize them against the backfilled counter.
4. Verify the upgraded write/read contracts and verify that the previous writer credentials and sessions cannot mutate the database. Only then resume writes and workers with the new credentials.

Independent downstream consumers must follow the same cutover procedure. Schema/capability checks in upgraded startup should reject incompatible adapters/schemas, but cannot protect against old binaries, which is why database access fencing is required. Zero-downtime mixed-version writes are out of scope. The implementation plan must separate automated migration/startup/old-request tests from provider-specific operator instructions for fencing credentials, terminating sessions, auditing copied integrations, and verifying access before reopening writes. CI passing does not certify that a downstream operator completed those deployment steps.

Old browser sessions connecting to the upgraded host without a token must fail closed and receive a reload-required warning. Do not silently accept old requests during a grace period. After new writes begin, rollback to an old writer is unsupported without another fenced maintenance procedure; restoring an older schema alone is not safe.

Revision metadata must remain outside schema-defined field data and generated collection field types. Update adapter contracts, SDK response types, host payloads, API documentation, and release notes. The spec does not prescribe a new public HTTP API.

## Acceptance criteria

Tests must establish these behaviors for collection documents and applicable singleton operations:

1. Two editors load the same revision. After one saves, every covered mutation from the other is rejected without changing persisted state.
2. Two simultaneous saves using the same revision produce one successful commit and one stale conflict in each database provider. The test must coordinate the race, not rely solely on sequential requests.
3. A metadata-only or status-only change invalidates an older editor even though the content version ID is unchanged. Reverting a value does not make an old token valid again.
4. A stale combined content/path/locales Save changes none of those values, creates no version, and leaves audit, schedules, and revision unchanged.
5. Publishing from a stale editor cannot publish another editor's newer content. An SDK replacement prepared from an older read is rejected too.
6. Missing preconditions fail at runtime, including JavaScript callers and direct host payloads. A current token succeeds; a stale no-op fails.
7. Changes to separate locales or fields still conflict. A stale historical source cannot be disguised by attaching a freshly fetched current token inside server mutation code.
8. Current editable reads are coherent under a concurrent content or metadata mutation. Historical/published reads cannot accidentally authorize writing unseen current state.
9. An empty singleton slot permits one first save; another save expecting that same empty slot fails.
10. Tree/order operations preserve their structural guards and advance affected revisions. Multi-target failure leaves all target mutations rolled back.
11. Scheduled publication validates its authorized target and freshness without invalidating itself merely by arming or claiming.
12. Stale errors survive host transport. The admin presents the specific warning, retains local edits, blocks further mutations, and discards changes only on explicit reload.
13. Successful saves establish a coherent new editing baseline. Committed hook failures remain distinguishable and are not retried as though no write occurred.
14. Automated checks cover migrations/backfills, startup rejection of incompatible schemas/adapters, direct maintenance mutation coverage, and rejection of old-client requests. Deployment-specific credential/session fencing and downstream script audits are separate operator acceptance checks in the cutover runbook.
15. Metadata-only edits suspend armed schedules, while arming/reconfirming does not invalidate its own authorized revision. Unexpected worker mismatches cannot publish. Upgrade leaves pre-existing schedules awaiting reconfirmation.
16. Re-anchor writes invalidate observed revisions, while repeated source-locale backfill on already stamped rows changes neither state nor revision. The normalization exception preserves effective locale semantics.
17. Revisions are positive safe-integer numbers through both drivers, SDK, and transport. Invalid values fail validation, and overflow never wraps or silently rounds.
18. Dedicated stale-error variants and low-level parent errors remain distinguishable. Lifecycle parent-stale normalization, absent singleton state, missing revisions, and unrelated conflict codes exercise their respective contracts.
19. A current combined Save with a conflicting path inserts no content version; a stale combined Save reports staleness first. External upload preparation never bypasses the guarded field attachment.
20. A successful structural mutation that suspends schedules for affected siblings/children returns an appropriate summary and displays a reconfirmation notice with an authorized review path. It must not silently suspend them, leak hidden document identities, or present committed structural changes as a stale rejection.

Use shared database conformance tests for provider-independent behavior, core unit tests for contracts and error paths, and host/admin tests for transport and recovery. Include an end-to-end two-editor scenario. During this spec-writing session no implementation or new tests are required.

## Tradeoffs and review decisions

Optimistic checks suit the expected editorial workload: editors do not hold database locks while typing, and normal public reads retain their caching model. The user has accepted reload-and-discard as the initial recovery. Document-wide invalidation also rejects unrelated locale edits; that is an explicit conservative design cost, not a claim that translation teams prefer it. Parallel translators may encounter significantly more conflicts than a small team editing different documents, and this cost should be accepted explicitly at review.

Locale-grain revisions are a deferred alternative. A future design could retain this document counter for shared metadata, add per-locale content revisions, and introduce a versioned composite precondition for shared state plus the edited locale. Migration could backfill per-locale counters from a consistent snapshot while preserving the current document-wide contract for old clients. Because localized writes currently carry other locales forward into a new content version, that change also requires merge/copy-forward and shared-field semantics; adding a locale column alone would not make concurrent translations safe. This release does not promise transparent migration or weaken cross-locale rejection.

Mandatory preconditions intentionally break blind SDK updates. A new document revision adds a schema migration but covers metadata changes that existing content version IDs cannot detect. Atomic combined saves require a core orchestration boundary rather than a warning-only UI patch.

The next review should explicitly accept or amend the following proposals before planning:

- An integer revision counter on `byline_documents` covering every editorial state change, serialized as a checked JavaScript number.
- Mandatory SDK/core/host preconditions with no normal unconditional-write option.
- Coverage of singleton, source-based, schedule, and tree/order actions as well as content and metadata.
- A single atomic boundary for combined admin Save.
- Coherent edit-read responses and explicit limitations on published/historical write preconditions.
- Metadata-triggered schedule suspension, affected-document rules for structural writes, re-anchor/backfill boundaries, and upload/hook limitations.
- Dedicated typed stale-error contracts and normalization of low-level parent conflicts.
- A fenced maintenance rollout that rejects old clients, and a warning with explicit reload as the initial recovery.
- The conservative cross-locale conflict cost, with locale-grain revisions deferred.

Implementation planning must resolve concrete signatures, snapshot mechanics, migration details, and lock ordering while preserving the specified scheduler transitions and other approved behavioral guarantees. Real-time presence, checkout leases, automatic retries, merging, and unsaved-work recovery across reload remain out of scope.
