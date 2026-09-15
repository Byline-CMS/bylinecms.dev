# Admin Forms and Document Lifecycle Review

**Review date:** 2026-09-16

**Reviewed commit:** `1f07c2e2` (`chore(release): 6.3.0`)

**Related issue:** [#94 — split FormContent into focused workflows](https://github.com/Byline-CMS/bylinecms.dev/issues/94)

**Status:** The review below records the original findings. The authorized implementation is summarized in [Implementation update](#implementation-update); the code changes are committed locally.

**Revision:** Reconciled with the supplied “Byline editor hot path review” and its follow-up response concerning the same commit. The comparison decisions and additional verification are recorded below; this document is the consolidated handoff.

## Executive assessment

The architecture is fundamentally sound. Retain it and continue the incremental refactor. The main concerns are specific correctness gaps at the boundaries between field hooks, validation, submission, and persistence—not the richness of the editor user interface.

The review covered the form renderer, form store, field rendering and hooks, uploads, relation picking, host handlers, document lifecycle services, revision guards, and associated tests. The checkout was clean at the end of the review. This document was subsequently added at the user's request.

Two findings warrant prompt attention: creation can bypass publication permissions, and declared field requirements are not consistently enforced on writes. The other findings concern asynchronous behavior, error visibility, upload retries, subscriptions, and read-only presentation. The legacy browser-suite failure is a maintenance observation, not an application defect or a release-gate failure.

The findings describe the reviewed state. They are not all attributed to the recent refactor.

## Architecture and pathway assessment

The principal boundaries are appropriate:

| Layer | Responsibility | Assessment |
|---|---|---|
| `FormProvider` and field widgets | Values, patches, errors, dirty state, pending uploads | Correct ownership; some subscription and hook defects |
| `useFormSubmission` | Validation → uploads → confirmation → submission | Useful extraction; retain its synchronous submission guard |
| `FormLayout` and page chrome | Recursive presentation and document controls | Sensible separation; no redesign needed |
| Host views and server functions | Navigation, notifications, transport, mutation receipts | Correct location, but repeated orchestration deserves attention |
| Core lifecycle | Authorization, normalization, hooks, versioning, metadata | Strong transaction model; authorization and validation gaps need fixing |
| Storage adapters | Atomic persistence, revisions, audit, scheduling | Substantial conformance coverage; both adapters passed |

### Main call paths

- **Collection creation:** form values → `useFormSubmission` → host `CreateView` → `createCollectionDocument` → core `createDocument` → initial-version persistence.
- **Collection save:** field patches and system-field dirty flags → submission hook → host `EditView` → `updateCollectionDocumentWithPatches` → core `saveDocument`. Empty patches select the metadata-only path; content patches select versioned persistence with optional metadata in the same guarded transaction.
- **Uploads:** pending files → upload executor → host upload transport → core field-upload service. Successful stored-file values enter form data before document submission.
- **Workflow and scheduling:** document controls → host callbacks → dedicated server functions and lifecycle operations. These act on persisted state and carry revision preconditions.
- **Tree placement:** sidebar widget → field services → structural lifecycle operation. This is an immediate, non-versioned mutation; its receipt updates the editor's observed revision without discarding unsaved content.
- **Duplicate, copy-to-locale, delete-locale, restore, and delete:** dedicated operations retain their distinct identity, locale, versioning, and post-commit semantics.
- **Singleton save:** the shared form feeds the singleton host view and lifecycle, including the empty-to-materialized transition and subsequent loader invalidation.

### Decisions worth preserving

- Content and system-field changes commit together, while metadata-only saves preserve non-versioned behavior.
- Staleness is checked before preparation and again under transaction locks.
- Rejected observations remain blocked; background refreshes cannot silently replace the revision associated with unsaved fields.
- Committed writes with failed follow-up hooks are distinguished from failed persistence.
- Tree changes, scheduling, and immutable document versions have explicit lifecycle semantics.
- Form-scoped IDs and portal-submit isolation are worthwhile foundations.
- The admin form remains independent of the host router and server-function transport.

## Findings

**Priority definitions:** P1 means resolve promptly. P2 means a concrete defect or editor inconsistency that should enter the normal fixing sequence. P3 means a lower-priority correctness or maintainability improvement with limited demonstrated user impact. File line numbers below refer to the reviewed commit; locate the named function if the code has since moved. Item numbers remain stable across review revisions.

### 1. P1 — Creation permits callers to bypass publication permissions

The create transport forwards `documentData.status`. Core creation checks `create`, then persists the supplied status without checking publication permission or whether the status belongs to the workflow.

**Confirmed against real Postgres:** an actor holding only collection `create` and `read` abilities created a document that was immediately readable as published. A separate unit probe also confirmed acceptance of an undeclared initial status.

**References:**

- [`packages/host-tanstack-start/src/server-fns/collections/create.ts`](../packages/host-tanstack-start/src/server-fns/collections/create.ts), lines 69–74: forwards the caller's status.
- [`packages/core/src/services/document-lifecycle/create.ts`](../packages/core/src/services/document-lifecycle/create.ts), line 131: selects `params.status ?? data.status ?? getDefaultStatus(definition)`.

**Recommendation:** ordinary admin creation should derive its status from collection configuration. If the lifecycle supports an explicit override, validate its membership and authorization centrally.

Removing the explicit host `status` argument alone does not close the gap: core also reads `data.status`. Reject or sanitize caller-controlled status in the field-data envelope and enforce the policy in core so SDK callers receive the same protection. Validate the final status after any preparation that can affect it.

Preserve the intended automatic-publication policy for `SINGLE_STATUS_WORKFLOW`; distinguish a configured default from a caller overriding an editorial workflow.

**Regression cases:** a create-only actor cannot override an editorial collection's initial status to `published`; undeclared statuses are rejected; configured single-status creation retains its intended behavior.

### 2. P1 — Declared field requirements are not consistently enforced on writes

The form validator only walks top-level fields. It does not descend into groups, arrays, or blocks. The ordinary server write path performs normalization and persistence without comprehensive schema validation.

**Confirmed:**

- A group missing a required child produced no form validation error.
- A real SDK create persisted a document missing its required top-level title.
- The form uses `noValidate`, so native browser validation does not fill this gap.

**References:**

- [`packages/admin/src/forms/form-context.tsx`](../packages/admin/src/forms/form-context.tsx), line 542: `validateForm`.
- [`packages/admin/src/forms/form-renderer.tsx`](../packages/admin/src/forms/form-renderer.tsx), line 460: `noValidate`.
- [`packages/core/src/services/document-lifecycle/create.ts`](../packages/core/src/services/document-lifecycle/create.ts), line 95 onward: preparation and persistence.
- [`packages/core/src/schemas/zod/builder.ts`](../packages/core/src/schemas/zod/builder.ts), lines 222–230: permissive block and group branches.

Simply connecting the existing Zod builder is insufficient: its group and block branches remain permissive.

**Additional impact confirmed during comparison:** lenient read schemas permit missing values but still reject invalid present values, including select options and workflow statuses. Three schema probes confirmed that a valid list response parses, while adding a document with an invalid select or status rejects the response. In [`collections/list.ts`](../packages/host-tanstack-start/src/server-fns/collections/list.ts), `list.parse()` can therefore fail an affected result page. The populated-relation branch bypasses this parse, so the other review's claim that this necessarily takes down the entire collection list for everyone is too broad. This is schema-level verification plus inspection of the caller, not a new database/browser reproduction.

**Recommendation:** establish one authoritative, recursive server validation boundary, with client validation providing corresponding field feedback. Cover nested required values, declared constraints, and relation cardinality. If incomplete drafts are intentional, express that as an explicit policy rather than accidental omission.

Keep server schema validation separate from browser field-hook execution. Account explicitly for defaults, server-assigned counters, locale representation, and conditional presentation.

Validate the final prepared document after transformations by lifecycle hooks, normalization, and counter assignment. For patches, validate the resulting document according to the chosen policy, rather than merely validating the patch envelope. The existing update schema is shallowly partial and is not a sufficient full-document validator. Decide explicitly how incomplete drafts and older documents affected by schema changes should behave; do not introduce an importer bypass without a concrete requirement.

Return structured, allowlisted validation issues through the mutation transport and map them to editor field errors. Do not serialize arbitrary Zod or hook internals. Array-index error paths need mapping to the submitted item's stable `_id`, with block and locale context; the existing path grammar helps represent paths but does not perform that complete mapping automatically.

Follow the existing decoder-and-wire-envelope pattern in [`document-mutation-errors.ts`](../packages/host-tanstack-start/src/server-fns/document-mutation-errors.ts), including `getDocumentStaleDetails` and `getDocumentRevisionValidationDetails`. Add a dedicated decoder for field-validation details and malformed-payload tests. Revision validation already uses `ErrorCodes.VALIDATION`, so distinguish its details from field errors; do not route every validation error into field-error mapping or create a parallel transport convention.

**Regression cases:** missing required root and nested values; nested constraints; relation bounds; create and patch/full-replacement updates; any deliberately supported incomplete-draft policy.

### 3. P2 — Older asynchronous field hooks can overwrite newer input

Each change starts an independent asynchronous hook pipeline. Every pipeline eventually commits its captured value, regardless of whether a newer change has completed.

**Reproduction:** enter `old`, then `new`; resolve the newer hook first and the older hook second. The stored value finishes as `old`.

This also affects advisory-only `beforeValidate` hooks. That path commits synchronously, then unconditionally commits the captured value again after awaiting the hook. A later keystroke can land in between, so the comment calling the second write a “no-op” is incorrect in that sequence, even if the hook never transforms the value.

**Reference:** [`packages/admin/src/fields/use-field-change-handler.ts`](../packages/admin/src/fields/use-field-change-handler.ts), lines 75–109, especially the unconditional commit at line 102.

**Recommendation:** give each field invocation a generation/token and discard superseded results, including stale errors. Also define how submission coordinates with outstanding change hooks.

**Regression cases:** out-of-order successful hooks, advisory-only completion after a later edit, out-of-order errors, and submission while a change hook remains pending.

### 4. P2 — Submit-time hook errors disappear from the editor

`runFieldHooks()` publishes hook errors, but the immediately following `validateForm()` replaces the error array. Submission correctly stops because it retains the returned hook errors locally, while the form can show no explanation.

**Confirmed:** a hook returning “Title is reserved” blocked submission, but `getErrors()` returned `[]`.

**References:**

- [`packages/admin/src/forms/use-form-submission.ts`](../packages/admin/src/forms/use-form-submission.ts), lines 238–246: submission sequence.
- [`packages/admin/src/forms/form-context.tsx`](../packages/admin/src/forms/form-context.tsx), line 614: error replacement; lines 698–700: hook-error publication.

**Recommendation:** collect both error sources, then publish one combined validation result.

**Regression case:** a submit-time hook error remains visible in the field and applicable tab badge after submission is blocked.

### 5. P2 — Partial upload failure repeats successful uploads

When any upload fails, `runUploads()` returns before adopting successful results or removing their pending entries.

**Confirmed:** with two files, the first successful file uploaded again on retry because the second file had failed.

**Reference:** [`packages/admin/src/forms/use-form-submission.ts`](../packages/admin/src/forms/use-form-submission.ts), lines 173–183.

This repeats storage work and upload hooks and can leave unused uploaded objects.

**Recommendation:** adopt successful results individually and remove only those pending uploads. Retain failed entries for retry.

**Regression case:** after one successful upload and one failed upload, retry transports only the failed file and retains the successful stored-file value.

A storage retention sweep may clean up abandoned objects, but it does not fix repeated uploads or repeated upload hooks.

### 6. P2 — Manual subscriptions can miss changes between render and subscription

`useFieldValue()` reads its initial value during render and subscribes in a passive effect without rechecking the snapshot.

**Confirmed:** a custom component writing in a layout effect left the rendered field showing `old` while the store contained `new`.

**Reference:** [`packages/admin/src/forms/form-context.tsx`](../packages/admin/src/forms/form-context.tsx), lines 846–857.

This gives the `useSyncExternalStore` investigation in #94 a concrete correctness motivation.

**Recommendation:** start with stable scalar snapshots and the replaced error-array snapshot. Treat composite field values separately: nested store updates currently mutate shared nested objects, so snapshot stability requires deliberate handling.

**Regression cases:** writes between render and subscription, a changed field subscription path, and composite-value updates with stable snapshot semantics.

### 7. P2 — Read-only presentation is inconsistent across widgets

The standard text widget does not forward `field.readOnly` to its input.

**Confirmed:** rendering a text field with `readOnly: true` produced an editable input.

**Reference:** [`packages/admin/src/fields/text/text-field.tsx`](../packages/admin/src/fields/text/text-field.tsx), lines 124–134.

**Broader scope and qualification:** code and numerical widgets explicitly honor the flag; the search found no corresponding handling in several other standard widgets, including text area, checkbox, select, datetime, relation, and array/block controls. Audit all built-in field types and their mutation controls, not just text. Only text was reproduced in a component probe; do not infer a verified count of affected behaviors from a count of source files.

The [`BaseField` type](../packages/core/src/@types/field-types.ts) explicitly says support is per-widget and is being introduced progressively. This is therefore an editor-consistency improvement, not a violation of an existing promise that every widget supports the flag. The confirmed text behavior remains worth fixing at P2 for computed or externally assigned values editors expect to keep locked. `readOnly` remains a presentation hint, never a substitute for server authorization.

**Recommendation:** implement consistent supported behavior and document any intentional exceptions. For non-text widgets, cover all editing controls and callbacks rather than merely applying a native input attribute. Clarify whether read-only structural fields also lock their descendants.

**Regression case:** a read-only text field displays its value and cannot be edited through the standard widget.

### 8. Observation — The paused browser smoke suite assumes unscoped field IDs

The existing create/edit smoke test waits for `#title`, then uses similarly fixed selectors.

**Confirmed in Chrome:** authentication passed, but the test timed out before entering content. A separate read-only probe found the actual title ID was `_R_16qpb6_title`, with no `#title` element. That observed ID is an example, not a stable selector.

**Reference:** [`apps/webapp/e2e/editor-smoke.spec.ts`](../apps/webapp/e2e/editor-smoke.spec.ts), lines 77–84.

**Priority correction:** the [testing guide](../docs/13-testing.md#legacy-editor-smoke-suite-paused) explicitly marks this suite as paused and says not to add coverage to it. It is absent from CI. The original P2 classification and recommendation to revive it were inappropriate; this failed diagnostic run is historical evidence about the retained files, not a current application or release-gate regression.

No repair is required by this review. If the project later chooses to revive or replace the suite, use accessible labels/roles or stable field selectors scoped to the relevant form. For current changes, use unit/component and integration coverage plus focused manual or in-app-browser verification, in keeping with the repository's testing policy.

### 9. P3 — Submission can re-enter during system-field confirmation

`submit()` releases its synchronous in-flight guard when it parks a payload in `confirmingSystemFields`. Another call can rerun validation and replace that payload while confirmation remains open.

**Confirmed during comparison:** call a captured `submit`, wait for confirmation, change the system path, then call the same captured callback again. The validation hook runs twice and the held payload contains the second path. No document is persisted by this probe. The modal makes ordinary keyboard re-entry difficult, so this is lower priority than the reproduced P2 defects.

**Reference:** [`packages/admin/src/forms/use-form-submission.ts`](../packages/admin/src/forms/use-form-submission.ts), lines 231–290.

**Recommendation:** define an admission rule spanning the parked confirmation phase and its confirm/cancel transitions. Retain synchronous protection against stale callbacks; a check of captured React phase alone is insufficient.

**Regression cases:** current and captured submit callbacks cannot replace an awaiting-confirmation payload; cancellation permits a fresh submission; confirmation delivers only the accepted payload.

## Issue #94 and maintainability

The [latest #94 update](https://github.com/Byline-CMS/bylinecms.dev/issues/94#issuecomment-5673569761) correctly identifies three unfinished items. Completion of the shipped extraction did not resolve this remaining scope.

### 1. Extract reload/focus recovery as one coherent workflow

Keep the synchronous mutation-block reference and imperative DOM focus references. Test successful reload, rejected reload, and focus restoration across actual host refreshes.

The extraction should make the existing lifecycle easier to inspect, without treating DOM focus as ordinary reducer state or weakening stale-callback blocking. Coordinate its ownership with the remount investigation below.

### 2. Proceed with the subscription investigation

The missed-update reproduction above justifies work here. Preserve `FormProvider` as the single owner of values and patches; a second form-wide reducer would add complexity.

Do not assume every current getter can immediately become a correct external-store snapshot. Scalars and replaced error arrays offer straightforward starting points. Composite field values require attention to nested mutation and snapshot identity.

### 3. Deduplicate status callbacks with a small action helper

The duplicated callbacks are modest. They do not justify a generic command framework.

The more substantial remaining orchestration is now in the host's [`collections/edit.tsx`](../packages/host-tanstack-start/src/admin-shell/collections/edit.tsx). Repeated mutation admission, receipt adoption, committed-error handling, notifications, and refresh logic deserve small shared helpers. Preserve explicit differences between delete, duplicate, locale operations, and saves.

### P3 — Reduce broad layout re-rendering on field edits

[`useFormTabs()`](../packages/admin/src/forms/use-form-tabs.ts) subscribes to the whole form even when no tab has a visibility condition. Each field-store write replaces the top-level snapshot and notifies that subscription. Because the hook runs inside [`FormLayout`](../packages/admin/src/forms/form-layout.tsx), ordinary keystroke commits trigger the layout walk and its un-memoized `FieldRenderer` components, including other rendered fields. This defeats much of the intended per-field render isolation even though `FormProvider` itself does not render on each keystroke.

This is a code-derived render path, not a measured latency regression. Hidden/unmounted tabs are not rendered, React can batch writes, and descendants can have their own memoization; “every widget on every keystroke” overstates the precise scope. The unnecessary propagation is nevertheless concrete and warrants a focused P3 improvement. Avoid full-value subscriptions when no tab condition needs them, and isolate condition-dependent layout work while preserving error badges and tab fallback. Measure render counts and interaction latency before adopting wider memoization or claiming a performance gain.

### Additional improvements worth considering

- **Use the existing typed submission payload throughout.** `FormRendererProps.onSubmit` still accepts `any`, while host handlers redeclare overlapping shapes. Tightening that boundary would prevent omissions without changing runtime behavior.
- **Stabilize the context API.** The provider constructs a new context object on render, including inline methods, and exposes an `errors` snapshot that becomes stale after ref-only updates. Stable callbacks and a memoized value can reduce context-driven work. Migrate consumers such as `useFormTabs` before removing the snapshot, and consider public compatibility. This is useful cleanup, not a prerequisite that makes `useSyncExternalStore` migration mechanical: composite values still share mutable nested references.
- **Keep host helpers narrow.** A shared mutation envelope and lifecycle-context builder could reduce repeated receipt/error handling. Audit unused `_editState` and `_createState`. Preserve target-locale navigation, schedule notifications, committed outcomes, and operation-specific behavior; do not assume every difference is accidental.
- **Validate transport envelopes.** Identity input validators do not establish runtime request shape. An authenticated admin request is still caller-controlled. Validate identifiers and patch envelopes separately from authoritative document validation, and define the transport's error mapping rather than assuming validation automatically produces HTTP 400 responses.

### Investigate focus across the version-keyed remount

The other review identifies a credible explanation for #98: `FormProvider` is keyed by locale and version, so a successful content save followed by loading a new version rebuilds the form subtree. Focus restored inside the old subtree can subsequently disappear when that subtree is removed. Current same-version focus tests do not exercise that sequence.

This does not mean every save remounts: metadata-only operations do not inherently create a new version. Nor does static inspection establish the browser timing or whether keyboard submission is affected. Treat the causal explanation as a hypothesis until reproduced through the host refresh path.

Add a regression that changes `versionId` across a save. If remounting remains the baseline-reset mechanism, keep focus intent above that boundary and restore by logical field path in the newly mounted form. Removing the version key requires a complete baseline-adoption contract for values, patches, errors, uploads, system slots, and widgets with cached state; it is a larger change with no demonstrated need here. The outer route's locale remount and #97 remain a separate ownership concern.

### Low-priority cleanup with qualifications

- `updateCollectionDocumentSystemFields` has no production caller in this repository, but it is barrel-exported and requests `reconcile: true`. Empty-patch `saveDocument` does not explicitly request reconciliation. Audit API consumers and intended reconciliation behavior before removal; the two paths are not automatically equivalent.
- Keep tab selection above boundaries it must survive. Combining selection and tab visibility into one hook is not inherently better and will not by itself fix route-level locale remounts.
- Retain `nextStatus` compatibility unless deliberately retiring that API. Deriving transitions centrally is sensible, but redundant-looking public props are not automatically disposable.
- A no-op edit can leave the form dirty. If this causes real editor friction, compare against a committed baseline and normalize patches consistently. Clearing only the dirty flag or using shallow equality is insufficient for nested content and subsequent saves.
- Do not remove the `initialValues` fallback merely because the store begins as a clone. Missing nested values, dirty-path behavior, and reset semantics need regression coverage before calling it vestigial.
- Correct the general statement that new related documents “start as a draft” in the [new-tab scope specification](2026-09-15-relation-picker-create-in-new-tab-scope.md). Creation follows the target workflow's configured default; single-status creation is immediately published. The current relationship documentation already describes the workflow distinction.

### Known browser issues remain separate

- [#97 — Tab selection resets when switching content locale](https://github.com/Byline-CMS/bylinecms.dev/issues/97).
- [#98 — Focus is lost to body after saving with the Save button](https://github.com/Byline-CMS/bylinecms.dev/issues/98).

These issues were read but not newly reproduced in this review. Component-level remount and focus tests cannot establish that the corresponding router/browser paths work. Both were open when checked.

## Limited modal creation

Restricting embedded creation to `SINGLE_STATUS_WORKFLOW` simplifies the editorial workflow, but does not remove the main coordination cost of embedding a second independently saved document. This qualifies the original review's description of the proposal as “materially simpler.”

Ordinary creation already publishes those collections automatically. It needs **one create operation**, without a subsequent publish transition.

Keep the current new-tab creation and explicit refresh as the default. A future limited modal should:

- Reuse `FormProvider`, `FormLayout`, and submission behavior.
- Have independent state and explicit dirty/dismissal handling.
- Preserve a created document's identity when subsequent display loading fails.
- Handle committed-with-warning and uncertain outcomes explicitly. A modal still needs these states; lack of space is not a reason to hide them or retry creation blindly.
- Respect relation capacity and avoid duplicate creation on retry.
- Fall back to the full editor for unsupported requirements, including fields requiring an already-saved document.

Workflow simplicity does not guarantee form simplicity. Target-form capabilities, including uploads, nested relations, and saved-document requirements, are at least as important. Use workflow policy, supported form capabilities, and explicit collection opt-in together. Neither workflow shape nor field simplicity alone is a sufficient eligibility rule.

The current [`Media` collection](../apps/webapp/byline/collections/media/schema.ts) uses Draft → Active → Archived. Restricting the feature to single-status collections would initially help collections such as [`news-categories`](../apps/webapp/byline/collections/news-categories/schema.ts), without solving Media creation unless its workflow policy changes.

The existing new-tab approach is a defensible product decision. The review does not establish a need to restart embedded creation immediately.

## Reconciliation with the other review

Both reviews examined `1f07c2e2`. “Accept” below means the evidence supports the observation; it does not authorize implementation. Original items 1–7 remain, with a broader and qualified read-only assessment. Item 8 is reclassified as a legacy-suite observation. Confirmation re-entry and broad layout re-rendering are P3 items.

| Other review item | Decision | Consolidated conclusion |
|---|---|---|
| Overall architecture and preservation of the refactor | Accept | Keep the existing boundaries, concurrency model, receipt handling, and form isolation. |
| “Everything else is maintainability work, not risk” | Refute | Reproduced async overwrites, invisible errors, upload retries, missed subscriptions, and ignored read-only presentation are correctness defects. |
| H1: missing lifecycle validation | Accept; qualify remedy | Shared P1. Add read-failure impact and structured field errors. Existing schemas and path helpers are incomplete for the proposed fix; validate after final preparation. Read failures depend on the affected page and parse branch. |
| H2: create publication bypass | Accept; qualify remedy | Shared P1. Removing explicit status forwarding alone leaves `data.status`. Configured-default publication is a deliberate policy: the claim that every other path to publication requires `publish` is too broad, including default-status content writes and locale copies. |
| M1: save remount and focus loss | Accept as hypothesis | New-version content saves remount the subtree. Actual #98 timing remains unconfirmed; metadata-only saves are not the same case. Preserve deliberate baseline reset unless a replacement is designed. |
| M2: host mutation/context duplication | Accept narrowly | Extract repeated mechanics while preserving operation-specific behavior. No evidence supports the predicted size reduction or a single universal handler. |
| M3: unstable context and stale errors | Accept; reject mechanical-migration claim | Stabilize the API and migrate error consumers. Mutable composite snapshots remain a separate correctness problem. |
| M4: partial uploads | Accept | Same reproduced P2; retention cleanup is supplementary, not a replacement for correct retry behavior. |
| L1: unused metadata function | Qualified cleanup candidate | No local production caller, but exported and explicitly reconciles. Audit those semantics and consumers before deletion. |
| L2: tab-state consolidation | No change justified yet | The ownership split supports remount survival. Consolidation alone supplies no demonstrated benefit. |
| L3: confirmation re-entry | Accept, P3 | Newly reproduced through a captured callback. Use a synchronous admission contract, not only a rendered-phase guard. |
| L4: API, input, dirty-state, fallback, and copy observations | Mixed | Accept workflow-copy correction and runtime input checks. Qualify API removal, equality-based dirty handling, and fallback deletion as above. Authentication does not make identity validation sufficient. |
| Test gaps and priorities | Accept seam coverage; refute “none material” for submission | Upload and error-publication probes demonstrate gaps. Existing DB suites are substantial, but do not prove the full host save path. Accept the follow-up correction: the browser suite is deliberately paused, so its stale selectors do not belong in the fixing sequence. |
| Single-status modal proposal | Accept coordination critique; qualify eligibility claim | Workflow restriction helps UX but leaves receipt, dismissal, and recovery complexity. Combine explicit opt-in with capability and workflow checks. A modal must still represent committed warnings. |
| Keep #94 bounded | Accept | Its three remaining tasks retain their own completion criteria; track other fixes separately. |

The supplied review's probe descriptions are corroborating evidence, not additional tests counted as executed here. New observations above are distinguished from reproduced defects and optional restructuring.

### Follow-up response disposition

The second reviewer accepted the consolidated findings and qualifications. Its remaining suggestions are incorporated as follows:

- **Accept:** remove the paused browser suite from P2 and the implementation sequence; explicitly acknowledge the earlier prioritization error.
- **Accept:** describe broad layout re-rendering as a concrete P3 opportunity, while keeping measured performance impact unclaimed.
- **Accept:** include the advisory-only hook race and follow the existing allowlist-decoder pattern for field-validation details.
- **Accept with qualification:** audit read-only behavior across all built-in widgets. The core type documents progressive, widget-specific support; the response's universal-contract wording and exact “14 widgets” count are not adopted as verified facts.

These final adjustments were verified by source and testing-policy inspection. No additional runtime tests were run for this follow-up; the earlier probe and suite results below remain unchanged.

## Verification

### Existing suites

**2,943 existing tests passed:**

| Suite | Passed |
|---|---:|
| Admin: 163 jsdom + 262 node | 425 |
| Core | 1,115 |
| TanStack host: 82 jsdom + 304 node | 386 |
| Client integration | 169 |
| Postgres integration/conformance | 414 |
| MySQL integration/conformance | 434 |

Commands:

```sh
pnpm --filter @byline/admin test
pnpm --filter @byline/core test
pnpm --filter @byline/host-tanstack-start test
pnpm --filter @byline/client test:integration
pnpm --filter @byline/db-postgres test:integration
pnpm --filter @byline/db-mysql test:integration
```

Database suites ran serially against the repository's guarded `_test` configurations. An initial sandboxed client integration attempt could not connect to local Postgres; the authorized rerun passed.

### Additional probes

- Six admin expectations for desired behavior failed, reproducing findings 2–7: nested validation, async hook ordering, hook-error visibility, upload retry behavior, read-only presentation, and missed subscriptions.
- Two core expectations for desired behavior failed: create-only publication was accepted, and an undeclared initial status was accepted.
- Two real Postgres probes deliberately asserted the observed problematic behavior and passed: create-only publication succeeded, and missing required fields persisted.
- The existing create/edit browser smoke test failed before document creation because it waited for `#title`.
- A separate read-only browser probe passed and confirmed the scoped title ID and absence of `#title`.

Playwright's bundled Chromium was absent. A temporary configuration used installed Google Chrome instead. Authentication succeeded. No document was created by the browser runs.

### Evidence location and limits

During reconciliation, four additional probe cases passed while asserting current behavior: one confirmation re-entry case and three list-schema cases (valid response, invalid select, invalid status). These are additional to the original 2,943-suite count, not a rerun of those suites. Copies are preserved as `review-comparison-probe.test.tsx` and `review-comparison-probe.test.node.ts` in the evidence directory below. No new database or browser run was performed for the comparison.

The reproduction probes and logs were preserved locally at:

```text
/private/tmp/byline-admin-review-evidence/README.md
/private/tmp/byline-admin-review-evidence/admin-probes.test.tsx
/private/tmp/byline-admin-review-evidence/core-probes.test.node.ts
/private/tmp/byline-admin-review-evidence/storage-probes.integration.test.ts
/private/tmp/byline-admin-review-evidence/browser-readonly.spec.ts
```

This directory is outside the repository and is not included when sharing or committing this document. An agent on another machine should use the self-contained reproduction descriptions above or receive a separate copy of the evidence directory. The local README records the original test-file locations and reproduction commands.

Temporary probe files were removed from the checkout after the review. During that review, no fixes, lint rewrites, commits, issue edits, or load benchmarks were performed. The full browser suite was not run. The passing suites do not negate the targeted reproductions.

## Recommended implementation sequence

1. Fix creation authorization and authoritative validation.
2. Add host-to-lifecycle create/patch coverage and a component save test spanning a new version. Verify relevant browser behavior manually or through the in-app browser; do not revive the paused Playwright suite as part of this work.
3. Address asynchronous hooks, error visibility, upload retries, subscriptions, and read-only presentation.
4. Complete #94's focused remaining work, coordinating the subscription fix and focus investigation with that issue. Keep host cleanup, confirmation admission, and the P3 layout-subscription improvement separate and proportional.
5. Revisit limited modal creation if it solves a recurring editorial need.

Keep independently verifiable phases separate. Preserve the successful architecture and editor behavior rather than expanding this review into a wholesale rewrite.


## Implementation update

The following changes implement the accepted findings from this review. The user explicitly chose to enforce required fields on **every content save**, including drafts and older documents missing newly required fields. The original review and its test counts above remain a historical record of `1f07c2e2`.

### Implemented behavior

- **Creation authorization:** core rejects undeclared initial statuses. A non-default initial status requires `changeStatus`, plus `publish` when selecting published. These checks cover explicit options and the legacy `data.status` fallback, before and after preparation. Creation at the workflow default remains authorized by `create`, including published-only workflows. The admin handler explicitly chooses the default.
- **Authoritative validation:** both shared persistence entry points validate the prepared content recursively after hooks, normalization, counters, and rich-text preparation. The checks cover required values, group/array/block shape, declared block variants, scalar constraints, custom validators, and relation cardinality. Optional absent containers remain valid. Rich-text JSON remains editor-independent. Create and update transport inputs now receive runtime shape checks.
- **Error transport and display:** field validation has a safe decoder and a serialized `{ field, message }` issue contract. Stable array/block identities address nested inputs; numeric normalization keeps its diagnostic path while supplying an editor instance path. Server rejection preserves dirty edits. Nested errors contribute to tab badges and structure fields can display their own errors.
- **Metadata behavior:** dedicated status/path/locale operations retain their non-versioned semantics. The admin skips content validation for a metadata-only save, so newly required content does not block a path-only correction.
- **Asynchronous hooks and submission:** superseded hook invocations cannot overwrite current values or errors. Submission waits for active field changes, retains submit-time hook errors, and releases superseded pending work. A parked confirmation has one captured payload; re-entry cannot replace it, and cancelled callbacks cannot submit it.
- **Upload retries:** successful uploads are adopted and removed from the pending set even if another upload fails. A retry uploads the remaining failures. A replacement selection made during an upload is preserved.
- **Form snapshots:** external-store hooks subscribe through React’s `useSyncExternalStore`. Nested writes clone their containing objects and arrays, preserving previous snapshots and unrelated references. The obsolete initial-value fallback was removed after a regression demonstrated that it resurrected descendants after their parent was cleared. Patch snapshots remain independent.
- **Layout subscriptions:** tab visibility observes predicate results, and tab errors observe the error store. An unrelated field edit no longer rerenders the layout merely because form metadata changed. No latency benchmark or performance multiplier is claimed.
- **Read-only presentation:** built-in scalar controls, file/image mutation controls, relations, arrays, blocks, and their descendants honor the hint. Preview/download and collapse actions remain usable. Custom widget/editor replacements remain responsible for their own presentation; this remains a UI hint, not server immutability.
- **Focused refactoring:** reload admission and existing focus recovery moved into `useDocumentReloadRecovery`; status-button and dropdown transitions share one callback. Operation-specific host and lifecycle orchestration remains explicit.

The field and client SDK references now document these contracts. The relation-create scope document now describes workflow defaults accurately instead of promising that every collection starts in draft.

### Implementation verification

| Suite | Passed |
|---|---:|
| Core | 1,132 |
| Admin | 179 jsdom + 262 node |
| TanStack host | 82 jsdom + 315 node |
| Client integration | 171 |
| Postgres integration/conformance | 414 |
| MySQL integration/conformance | 434 |
| **Total** | **2,989** |

New coverage includes the actual built host create/patch handlers driving core persistence against Postgres, serialized errors through the installed server-function HTTP serializer, invalid patches leaving revisions unchanged, nested validation, stale hook ordering, upload retry behavior, cancelled confirmations, snapshot isolation, read-only inheritance, and a component save followed by installation of a new document version. The host-to-Postgres test shares the client suite’s serial database fixture; Turbo explicitly builds its host dependency before client integration/typechecking. Session acquisition and compiler binding are supplied by the test harness; these tests do not claim to exercise browser authentication.

The static checks passed: repository lint, repository typechecking, Knip, generated collection-type freshness, documentation validation, and `git diff --check`. The generated-type and documentation checks used their underlying `node --import tsx` entry points because the `tsx` CLI’s IPC socket is blocked by the sandbox. Database suites ran serially against guarded `_test` databases.

A focused browser check on the running local application opened a Page create form, left the title empty, added an empty quote block, and attempted a save. Required errors appeared on the title, summary, and nested quote, with the matching Details and Content tab badges. The unsaved form was discarded and the browser returned to the dashboard. No document was created or published by that check. The paused Playwright suite was not revived.

### Deliberate follow-ups

- **Focus across a new version remount (#98):** the extraction preserves existing focus behavior. The new-version component test verifies the clean data/patch baseline; it does not establish focus restoration across remounts. No claim is made that #98 or the separate route-tab issue #97 is fixed.
- **Relation modal creation:** still deferred. Creation at a published-only workflow’s default is authorized correctly, but this implementation does not add a modal or broaden relation-picker scope.
- **Optional cleanup:** no public API removals, wholesale form-store replacement, or generic host-operation framework was introduced. Those proposals still require a concrete maintenance benefit.

The implementation was committed in these independently reviewable steps:

- `6fec4c1f` — enforced document validation and creation status permissions.
- `e7da4d3f` — stabilized form state and submission behavior.
- `0d163523` — extracted reload recovery and shared status actions.

No push, issue closure, or deployment was performed.

## Follow-up: restore as a recovery operation, and the condition contract

A second review of the implementation above raised two consequences of enforcing
validation on every content save.

### Restore is exempt from field validation

Validation sits on the two shared persistence entry points, so it also gated
`restoreDocumentVersion`. Duplication and locale copies read the *current*
version, which the editor can open, correct and save, so a refusal there is a
prompt to act; they keep the gate. A restore reads a *historical* version, which
no route can edit, so a refusal there is a recovery dead end.

The position moved twice before settling, and both intermediate positions are
recorded because the reasoning matters:

1. **A blanket `validateContent: false`** was rejected. Restore is not an
   unchanged replay — `beforeUpdate` and `applyRichTextEmbed` mutate the source
   tree before persistence — and prior persistence proves nothing about validity,
   since authoritative validation did not exist before this work. A general
   option also invites use from paths that should never have it.
2. **A `required`-only waiver, refused when the destination status is
   published**, was implemented and then withdrawn. It assumed the only way a
   historical version can fail is a field that became required. That is wrong on
   both halves: validation *rules* changed in this release independently of any
   schema — the corrected `email` and `url` rules had previously been inert — so
   versions under entirely unchanged collections could stop restoring today. And
   refusing to waive into a published status leaves published-default workflows
   with the original dead end.

**Implemented.** Restore is exempt from the field-validation gate. The exemption
is tied to `action: 'restore'` rather than to a caller-supplied flag, so a write
cannot obtain it without also declaring itself a restore in the audit trail; the
document and singleton restore services are the only writers of that action. A
restore remains subject to authorization, revision and version-ownership checks,
hooks, and storage constraints.

Validation still runs on a restore, for reporting only, after the hook and embed
pass so it describes exactly what is persisted. The issues return as
`validationIssues` on the restore result and the admin reports them in a warning
toast naming the fields, so the next ordinary save's refusal is understandable.
Failed duplications and locale copies now name their offending fields too,
instead of showing a generic failure.

`DocumentFieldIssue` carries `kind: 'required' | 'invalid'`. Nothing branches on
it to decide whether a write proceeds; it exists so the editor can separate what
is missing from what is wrong. A custom `validate` callback's message is always
`invalid`, even when it describes a conditional requirement.

**Consequences, stated rather than engineered around:**

- A `beforeUpdate` hook on a restore runs inside the exemption.
- A workflow whose `defaultStatus` is `published` republishes restored content
  that fails current validation.
- Publication is a separate boundary in any case: status is lifecycle metadata,
  so `changeStatus` mutates it in place without validating content. An
  incomplete draft can reach `published` through an ordinary transition whether
  or not a restore put it there. Content validation gates content writes; it is
  not a publication gate.

**Deferred: schema-aware restoration.** A historical version may be incompatible
with the current schema in ways validation cannot see, because reconstruction
resolves stored rows against today's field set and does not preserve data it no
longer recognises. Identifying the schema a version was written under (a
collection's current fingerprint is insufficient unless the fingerprint is
retained per version), reconstructing without loss, treating renames and type
conversions as explicit migrations, and repairing a restore candidate before
committing it, all need their own design. Skipping validation does not address
any of them. The next useful step is to verify historical schema identification
and reconstruction behaviour, then choose the smallest restoration change that
preserves data and permits repair.

### The condition contract stands

`condition` is documented as a rendering hint that the lifecycle does not
evaluate, with the remedy stated alongside it. A proposal to make the lifecycle
condition-aware was withdrawn: it would have changed a stated contract, skipped
all validation for a hidden field rather than only requiredness, and could not
hold its "same predicate, same result" claim — restore and duplicate validate
with `locale: 'all'`, where a localized value is a per-locale map rather than the
single value the editor supplies, so a predicate reading one disagrees with
itself across those paths.

No code change. The documentation now names the pattern that actually enforces a
circumstantial requirement — `optional: true` plus a `validate` callback, which
the lifecycle enforces and the admin reports wherever the field is visible — and
records the `locale: 'all'` shape difference.

### Review of the exemption commit

A review of `bcb0f927` accepted the exemption and found three gaps, all fixed.

**Advisory validation could still block a restore.** The diagnostic pass runs
`validate` and `condition` — schema-author callbacks — against data they may not
anticipate. A validator calling `value.trim()` throws when a historical version
lacks the field, and the exception escaped, aborting the recovery the exemption
exists to protect. Reproduced for both callbacks.

`validateDocumentFields` now isolates each callback and records a failure as an
`invalid` issue rather than letting it escape. This fixes more than restore: an
ordinary save previously surfaced a raw `TypeError` from the lifecycle and now
refuses the write with a readable field message, so validation stays strict
where it should be. The walk also keeps collecting issues after one callback
fails, instead of discarding what it had. A throwing `condition` fails closed —
the field stays visible and validated — and is reported, so the misconfiguration
is loud rather than silently hiding a field.

**Singleton reporting was incomplete.** Singleton restores shared the
persistence exemption but never computed `validationIssues`, so the shared
restore modal could not show the warning the collection path promised.
`restoreSingletonVersion` now returns them through a
`RestoreSingletonVersionResult`, threaded through the client handle. Singleton
copy-to-locale showed a generic failure; it now names its invalid fields through
the same `describeMutationFailure` helper the collection view uses, extracted so
the two cannot drift.

**Publication guidance named the wrong hook.** The fields reference recommended
`beforeUpdate` for publication preconditions, but status transitions invoke
`beforeStatusChange` (`document-lifecycle/status.ts`, and scheduled publication
in `scheduled-publish.ts`); a precondition placed in `beforeUpdate` would not
have guarded that pathway at all. Corrected, with the distinction stated.

### Verification

Repository lint, typechecking, Knip, documentation validation and
`git diff --check` passed. Unit suites passed in full; the integration suites
passed against the guarded `_test` databases. New coverage: issue
classification, custom-validator classification, the decoder's refusal to infer
a `kind` from a malformed payload (unit and over the installed server-function
serializer), and five lifecycle cases — restore reports a version predating a
required field, restores content failing a rule whose schema never changed,
restores into a published default status, omits `validationIssues` for a clean
source, and does not extend the exemption to duplication. The review fixes add
five callback-isolation cases, an end-to-end restore against a throwing
validator, and two singleton reporting cases.
