---
title: "Embedded relationship creation — specification"
path: "embedded-relationship-creation-spec"
summary: "Create a related document inside the relationship picker using the ordinary collection form, retaining its identity independently of display loading and parent-document persistence."
---

# Embedded relationship creation — specification

Companions:

- [Relationships](../docs/04-collections/03-relationships.md) describes stored references, display records, and status-aware reads.
- [File and media uploads](../docs/04-collections/06-file-media-uploads.md) describes field uploads and document creation.
- [Document paths](../docs/04-collections/05-document-paths.md) explains server path derivation when creation supplies no explicit path.
- [Content locales](../docs/08-internationalization/03-content-locales.md) describes the default-locale creation rule and subsequent translations.
- [Testing](../docs/13-testing.md) describes package test modes and browser-test prerequisites.

Date: 2026-09-14. Status: consolidated draft for review. This document combines the design discussion and implementation requirements; it is the single specification for this feature. The embedded-creation feature is not implemented. Proposed defaults and API decisions that still need review are listed at the end.

## Purpose

Embedded creation lets you create a related document while editing its parent document. For example, while editing news, you can create a media item in the `news.featureImage` picker and select it without navigating away from the news form.

The related document is saved independently. Selecting it changes the parent form's local relationship value; saving the parent persists that relationship. Abandoning the parent edit or removing the selection does not delete the created document.

The embedded creator shares the ordinary collection form's fields, validation, field hooks, upload execution, and document creation transport. Its surrounding interface is a view inside the existing relationship picker.

### Worked example: news to media

1. Open **Feature Image** on a news document and choose **Create media**.
2. The modal switches to the media form: image, title, alt text, caption, and credit. Search, page, and pending picker selections are retained.
3. **Create and select** validates the form, uploads the image, and creates the media document through the ordinary editor flow.
4. The new media reference becomes the news form's selection and the picker closes. Display details can finish loading in the relation field.
5. Save the news document to persist the relationship. Discarding the news edit leaves the media document saved independently.

For a multiple relation, creation returns to the picker with the new item checked; the user confirms the pending selections before they are added to the parent form. **Back** from an unsaved creation view returns to the previous picker view, after discard confirmation when necessary.

## Design rationale

The full-page editor and the embedded creator share form behaviour while composing different surrounding controls. This keeps schema, validation, widgets, field hooks, and uploads on one implementation path without adding an expanding set of suppression flags to the full-page renderer. Media's existing field order already provides the desired image-first presentation.

A temporary upload-and-create implementation was considered and rejected. The upload endpoint can assemble document data through `buildDocumentData(...)`, but the editor uploads field values and then submits the complete form. Both paths reach the core lifecycle; their payload assembly, orchestration, and file cleanup on failure differ. Shipping the endpoint-assembled path first would introduce a second media creation behaviour that this feature would later have to reconcile.

Switching views inside the existing picker preserves the user's selection session and avoids adding a second creation modal. A drawer remains a possible future presentation, but does not remove the need to isolate field stores, submit events, dismissal, and focus. It does not inherently require URL state. Neither a drawer stack nor an editor navigation stack is a prerequisite here.

The ownership boundary follows persistence: the creation form is temporary, while a saved target must remain identifiable after that form closes. Fetching a title or thumbnail is a separate read. A display-read failure must therefore produce a saved selection with recoverable presentation, rather than another creation attempt.

## Scope

The first implementation covers the built-in single and multiple relation fields, with media as the first application. The form behaviour is collection-based rather than media-specific; a small text-only target collection must also exercise the same path in tests. This proposal adds no narrowed `createFields` schema or pluggable creation implementation API.

Only one embedded creation session may be active within a parent editor. Relations inside that creation form may select existing documents through the existing picker behaviour, but may not start another creation session. Editing existing targets in place, arbitrary creation nesting, drawer stacks, URL-backed picker navigation, bulk uploads, and creation from a typed search term are outside this version. Collections that require creation to be atomic with their parent's save are outside this version; there is no automatic cleanup of independently created documents.

Other consumers of `RelationPicker`, including rich-text insertion dialogs, must retain their current selection behaviour. Enabling creation in those consumers requires a separate review of how they retain created identity and display state; a new transport must not automatically enable the affordance everywhere.

## Current implementation and constraints

The following facts are verified against the repository and distinguish existing behaviour from the changes proposed below.

| Area | Current behaviour | Consequence |
|---|---|---|
| Target configuration | Relation fields resolve the target definition and admin configuration on the client. | The creator can use the target schema and presentation configuration without navigating to its create route. |
| Form state | `FormProvider` owns instance-local field values, errors, dirty tracking, patches, and pending uploads. | The embedded form gets a new provider instance; it never shares the parent's mutable store. |
| Uploads | `forms/upload-executor.ts` calls `uploadField(..., false)`, then the editor submits document data through `createCollectionDocument`. | Embedded creation must follow this existing sequence. |
| Upload endpoint creation | `core/services/field-upload.ts` also supports creating a document through `buildDocumentData(...)`. Both paths eventually use the core lifecycle, but payload assembly and failure cleanup differ. | Do not use this alternative branch for embedded creation. |
| Picker selection | Single confirmation finds an optional display record in `documents`; multiple selection retains records in a map. Both depend on a collection ID supplied by list loading. | A newly created selection must carry identity without requiring a list row or a completed list request. |
| Layout | `layout.sidebar` may contain schema fields as well as sharing a visual region with system controls. | Omitting page controls must not omit sidebar schema fields. |
| Required fields | Fields are required unless `optional: true`. Media requires image, title, and alt text; caption and credit are optional. | The shared form must preserve this validation. |
| Locale | Core `createDocument` rejects a supplied locale other than the installation's default content locale. | Parent-locale inheritance must yield to this rule; no new locale lifecycle is introduced. |
| Creation outcome | The host reports `committed-hook-failed` with document identity and a safe warning when an after-create hook fails after persistence. | This is a saved document with a warning, not permission to create again. |
| IDs | Field IDs derive from field paths; tab IDs derive from tab-set names. | Concurrent forms need an instance scope for IDs and their accessibility references. |

Navigation guards are already injectable through a prop or context. Extracting recovery code under issue #94 does not itself implement modal dismissal or coordination with a parent editor.

The fallback guard handles browser unload; it does not block client-side route navigation. Provider isolation covers field stores only. It neither scopes DOM IDs nor establishes correct focus, dismissal, or event propagation.

## User interaction

### One picker session, two views

The picker has a selection view and a creation view within the same modal. Its session state remains mounted across view changes: query, page, pending selections in selection order, collection identity, and any created-document receipts. A receipt is the confirmed identity and outcome of a completed creation.

The selection view exposes **Create {target label}** when the host supports embedded creation and the user has the target collection's create ability. Existing list access and server read rules still apply. A loading or failed list request does not prevent creation solely because it has not supplied a collection ID.

Entering creation changes the modal title and moves focus to an appropriate heading or first editable control. Returning to selection restores the previous query, page, and pending selections. Opening a genuinely new picker session retains the existing reset behaviour; switching views must not trigger that reset.

### Creation view

The view renders the target's ordinary creation fields under an independent `FormProvider`, in create mode. The view supplies its heading, primary submit action, and **Back** action. It omits the full-page heading row, document action bar, workflow transition controls, concurrency notices, scheduling, and system path/tree/advertised-locale widgets.

Field rendering preserves schema defaults, custom widgets, read-only behaviour, conditions, groups, tabs, validation, and field hooks. Main and sidebar field layouts remain accessible, with sidebar field content placed after main content in the compact layout. Fields hidden by their existing conditions remain hidden; fields do not disappear merely because their configured region was a sidebar.

Media needs no separate upload layout: its default layout already renders image, title, alt text, caption, and credit in declaration order.

The view explains that the new document is saved independently of the parent. For media it also explains that creation normally produces a Draft that must be activated through the ordinary media editor before public reads can expose it. No automatic publication or activation accompanies selection.

### Single relation

The primary action is **Create and select**. When the server confirms creation, retain its receipt before any display fetch or view transition. Transfer the reference and its presentation state to the parent relation field and close the picker. Do not wait for a thumbnail or label to make the relationship selection valid.

The selected relation field shows a loading presentation while details load. If loading fails, it shows **“Media item created — details unavailable”** and **Retry loading details**, using the target label for other collections. The reference remains available to parent-form submission, subject to ordinary server validation and access rules.

The parent relation field owns this state after the picker closes. A later fetch completion must apply only to the same selected target and locale; removing or replacing the selection must not allow a stale response to restore it.

### Multiple relations

The primary action is **Create and add to selection**. On confirmed creation, append the target to the pending selection set once and restore the selection view. Preserve previous selections and their order. The parent relation array changes only when the user confirms the picker, following its existing multiple-selection behaviour.

A created selection must remain visibly represented even if it does not match the preserved search or appear on the current page. Show it in a selected-items area with its loading, warning, or retry presentation. Do not insert it into a filtered result page as though it matched the query.

Existing parent references and pending selections must be deduplicated. Respect relation cardinality: do not offer creation when adding its result would exceed `maxItems`, and recheck the current parent value on confirmation. A rejected addition never rolls back the independently created document. This draft includes the necessary capacity handling in the new workflow, without proposing a broader relation-validation redesign.

If the user closes the selection view without confirming, pending selections are discarded according to current picker semantics. Any documents already created remain saved. Reopening the picker can find them through ordinary list reads.

## Submission and lifecycle contract

Submission follows the full-page editor's shared behaviour:

1. Run field hooks and validation through the shared form logic.
2. Execute deferred uploads using `createDocument: false`, without an existing document ID, retaining the ordinary upload context and progress behaviour.
3. Submit the complete create data through the host's existing `createCollectionDocument` path, using returned `StoredFileValue` values for uploaded fields.
4. Record a confirmed receipt before fetching display data or unmounting the embedded form.

The create transport consumes full document data, not an update-patch operation. `FormProvider.setFieldValue` records patches without a create/edit distinction, so create-mode changes can accumulate patches internally. The create request still submits complete data rather than those patches. System-field confirmation remains edit-only.

Do not duplicate collection hook invocation in the picker. Server normalisation, authorisation, counter allocation, path derivation, persistence, and after-create hooks remain in the existing lifecycle. Keep upload processing and document submission single-flight from validation through completion so double clicks or Enter presses cannot launch parallel attempts.

This specification does not add transactional rollback across file storage and document creation. Preserve the ordinary editor's upload retry and cleanup behaviour; an uploaded file does not by itself prove a document exists. Once a document is confirmed, abandoning selection must never delete it or its files.

### Locale and omitted system controls

Embedded creation uses the installation's configured default content locale, obtained from host configuration rather than a hard-coded `en`. If the parent is editing another locale, show **“New documents are created in {locale}”** before submission. Keep the parent's active locale unchanged. There is no embedded locale switch or automatic translation creation in this version.

Hydrate the created display record explicitly in its creation locale. That label or thumbnail is presentation data; it does not assert that translated content exists in the parent's locale. On a later ordinary parent read, existing locale and fallback rules apply. When the locales differ, keep the creation locale identifiable in the selected-item presentation.

Do not submit a publication transition. The existing lifecycle resolves initial status; for the current media definition its normal default is `draft`, displayed as Draft. A successful admin selection does not change public read or populate rules.

Omit explicit system path and advertised-locale overrides from this compact surface. The server derives the path through its existing rules; a new document's advertised-locale set remains empty unless ordinary lifecycle behaviour establishes it. No separate tree placement is performed here. Collections whose editorial workflow requires those controls must use the full editor for those operations; this feature must not fabricate values for omitted controls. Existing upload fields that require a saved document retain that restriction.

Path derivation uses the configured `useAsPath` source where available and the existing UUID fallback otherwise; omitting the widget does not create a pathless document. The collection's `lockPath` setting is an admin editing restriction, not a different server derivation policy. If creation reports `ERR_PATH_CONFLICT`, retain the unsaved form and show the conflict without automatic suffixing or resubmission. The user can correct an editable source field and retry. If the source is not editable here, explain that the conflict requires resolution outside this view; do not offer an override of a managed path.

## Ownership and host boundary

| Owner | State and responsibilities |
|---|---|
| Embedded form | Field values, errors, dirty state, pending uploads, tab state, validation and submission phases. This instance is discarded when the creation view closes. |
| Picker session | Selection-view state, confirmed creation receipts, pending selections, display loading while the picker remains open, and committed-hook warnings. |
| Parent relation field | Its local stored reference or reference array, plus display loading, retry, and warning state transferred when selection is confirmed. |
| Host adapter | Capability resolution, default locale, authenticated create transport, authorised display reads, and safe outcome translation. |
| Core lifecycle | Server policy, normalisation, hooks, and persistence. |

`@byline/admin` must not import TanStack routes or server functions. The implementation needs host-neutral access to three capabilities: creation eligibility/context, creation, and reading a display record by document ID. The existing `BylineFieldServices` provider is a possible home, but exact exported names and provider placement are reserved for API review. This draft specifies the behavioural contract rather than declaring an unimplemented public API.

Capability resolution must use the host's actual ability mapping, including super-admin handling, rather than duplicating permission logic or assuming a collection path always forms the ability key. The UI decision is cosmetic; every server action remains independently authorised. Missing host support leaves existing selection usable and creation unavailable.

A server permission rejection must be displayed even if the client snapshot allowed the affordance. Keep entered values, explain the rejection, and refresh capability state when the host supports it. A client check and visible handling of server rejection are both required; they are not alternative security policies.

Every confirmed creation outcome must supply both `targetDocumentId` and `targetCollectionId`, including a committed-hook warning outcome. The host already resolves the collection before creating; return its identity through the create response or an equivalent guaranteed receipt. A list request or display fetch must not be a prerequisite for recovering that identity. Retain document version and revision metadata where provided by the existing outcome.

The existing `RelationPickerSelection.record` is optional, which already permits a reference without display data. That fact does not settle the new transfer contract: the current parent record cache has no loading, retry, or committed-warning state. Extend the selection handoff or a shared presentation store so those states survive picker closure, without making a fetched list row mandatory. Do not assume closing a modal necessarily unmounts the picker; design correctness around explicit session boundaries and the parent field's lifetime.

Display hydration must read the exact target ID under ordinary admin read rules, with an explicit locale and the fields needed by the picker/summary presentation. The existing list contract cannot express an exact-ID lookup. Add or adapt an authorised read capability; refreshing the current search page is not sufficient. Do not require an edit-specific read capability merely to display a selectable document, and do not bypass read hooks or access filters.

Display state is separate from the persisted relationship reference. Loading flags, errors, retries, and hook-warning metadata must not be written into schema data. A relation can have a complete identity and no display record.

## Failures and recovery

| Outcome | Required behaviour |
|---|---|
| Field validation fails | Stay in creation, preserve values, expose field errors through the ordinary form behaviour, and send no document create request. |
| Upload fails | Stay in creation, preserve editable values and ordinary retry behaviour, identify failed fields, and send no document create request until uploads succeed. |
| Server definitively rejects creation before persistence | Keep the form dirty and editable. Map field errors when provided; otherwise show a form-level error. A user may correct the problem and retry. |
| Creation commits and an after-create hook fails | Retain the receipt, select using the same rules as success, and retain a visible saved-with-warning notice. Do not return to a fresh Create action or re-run the hook by creating another document. |
| Creation commits but display hydration fails | Retain the receipt and selection. Retry only the display read, including after a single-select picker closes. Do not infer deletion or revoke the relationship solely from a failed read. |
| Creation commits but applying the selection fails | Keep a saved-result view with the receipt and an action to retry selection or return to selection. Do not remount an empty creation form as recovery. |
| Request fails without a definitive persistence outcome | Show that creation could not be confirmed; do not describe it as definitely unsaved or automatically repeat the mutation. Offer a return to selection to check for the item before an intentional new attempt. |

The last case does not promise exactly-once creation across lost responses, reloads, or browser crashes. A durable idempotency/reconciliation protocol is outside this version. Confirmed identity must never be lost through ordinary view transitions; unknown outcomes must not masquerade as confirmed failures.

The hydration warning is distinct from an ordinary missing-target indication. Submitted field values may have been changed by hooks, so they must not be presented as a canonical hydrated record.

## Dismissal, navigation, and accessibility

**Back** leaves the creation view and returns to selection. A clean form leaves immediately; a dirty form asks whether to discard its unsaved changes. Cancelling that confirmation retains values and focus. Closing the modal through its close control, Escape, or backdrop uses the same dirty check, then completes the originally requested close action. A discard confirmation must not cause one Escape event to dismiss both layers.

Keep the creation view mounted while validation, upload, or creation is in flight. Disable Back and modal dismissal during that interval. Browser unload cannot guarantee cancellation; do not present it as rolling back a request.

Leaving the parent editing session through routing or browser unload must account for both forms' unsaved state, including when the parent itself is clean. Coordinate this with the existing parent guard so one navigation does not produce competing confirmations. Discarding only the embedded form must not clear the parent's dirty state, patches, or blocker. The exact guard adapter is an implementation decision with these behaviours as acceptance criteria.

The embedded form must isolate submit events even though the modal content is portaled. Its submit or Enter action must not invoke the parent's submit handler. Controls that do not submit use explicit button types; footer submission must target only the embedded form. Retain native keyboard and form behaviour where applicable.

Introduce one stable, instance-specific scope for form, field, label, help, error, tab-trigger, and tab-panel IDs. Scope generation must work through server rendering and hydration. Keep data paths, field names, patches, and schema identifiers unchanged. Apply the scope to fallback IDs in directly rendered widgets as well as `FieldRenderer`; audit derived IDs and accessibility attributes together. Do not double-prefix caller-supplied IDs, and document the explicit-ID contract in that separate change.

Focus belongs to the active view or confirmation. Busy-state recovery must not focus controls in a hidden list or closed creation view. On Back, restore focus to the Create affordance; on final close, restore focus to the parent relationship control. Existing nested selection dialogs must remain operable without enabling nested creation.

## Translation and copy

All new strings belong in the `byline-admin` namespace. Parameterise collection labels, status labels, and locale labels. Populate all current bundled locales in the same implementation change: `en`, `fr`, `de`, `es`, `it`, `ko`, `th`, and `zh-CN`. The existing bundle tests enforce key parity across all eight.

Required copy covers Create, Back, Create and select, Create and add to selection, independent persistence, creation locale, draft/public availability, discard confirmation, capacity limits, saved-with-hook-warning, details unavailable, retry details, retry selection, and an unconfirmed creation outcome. Reuse existing keys where their meaning matches exactly. Final wording and translations are reviewable implementation content; the media fallback above establishes the intended meaning.

## Coordination with issue #94

[Issue #94](https://github.com/Byline-CMS/bylinecms.dev/issues/94) proposes splitting `FormContent` while preserving the public `FormRendererProps` API and editor behaviour. Embedded creation should inform the boundaries of submission, tabs/layout, and presentation extraction without becoming an implicit addition to that refactor.

The proposed sequence is:

1. Land the relevant behaviour-preserving extractions from #94: shared submission, tabs/layout, and page presentation boundaries. Reload/focus extraction may help, but injectable guards already exist. Store subscription changes and unrelated status-action cleanup are not prerequisites.
2. Land form-instance ID scoping as a separately reviewed correctness change, with concurrent-form and tab accessibility coverage.
3. Review and add the embedded form surface, host capabilities, and selection/presentation state described here. Deliver media through the ordinary form and create transport.

Preserve synchronous mutation blocking, upload sequencing, dirty-state semantics, and existing full-page editor behaviour throughout. Do not introduce a second source of truth for field data. There is no interim upload-endpoint creation implementation and no requirement to complete every #94 step before this feature.

## Acceptance criteria and verification

The implementation is complete when the following behaviours are demonstrated:

- News can create and select media without saving or navigating away from the news document; image, title, and alt text remain required.
- A text-only collection uses the same creation logic. A layout fixture with sidebar fields, conditional fields, and tabs retains its ordinary editing and validation behaviour.
- Single selection works before any list page resolves and when the new item is absent from the current page. Its details retry remains usable after the picker closes.
- Multiple creation preserves query, page, pick order, and existing selections; new items remain visible outside matching results; confirmation deduplicates and respects capacity.
- Failed hydration cannot issue another create request. A committed-hook warning retains identity and a visible warning through form unmount and selection transfer.
- Selection-application failure retains a saved result. An uncertain transport outcome is distinguishable from a definitive pre-commit failure.
- Upload, validation, and creation failures retain appropriate form state. Repeated submit actions during any submission phase cannot launch parallel uploads or creates.
- Back, modal close, nested confirmation, route navigation, and browser unload have the documented dirty-state behaviour for clean and dirty parent forms.
- Parent and embedded forms with matching `title` fields and matching tab-set names have distinct IDs and correct label/description/tab references. Embedded submit never submits the parent.
- Focus stays in the active view through validation errors, upload progress, saved warnings, Back, and final dismissal; late reads cannot restore a removed selection.
- Missing capabilities and denied or revoked permissions degrade correctly; authenticated server checks remain authoritative. Selection-only picker consumers remain unchanged.
- A non-default-locale parent visibly creates in the configured default locale without changing the parent's locale. Media creation remains Draft under its normal lifecycle, and public read rules remain unchanged.
- A target with `useAsPath` uses ordinary server derivation; a target without it receives the ordinary fallback path. A path conflict preserves values, exposes the conflict, and performs no automatic create retry. Omitting advertised-locale controls sends no override and does not invent available translations.
- Every new translation key exists in all bundled locales, and existing full-page editor, scheduling, navigation, upload, and concurrency coverage remains green.

Use component tests for session state, view transitions, submission isolation, and receipt transfer; host tests for both creation outcomes and exact-ID reads; and real-browser coverage for portals, focus, Escape, and label/tab ownership. Tests must exercise user-visible contracts rather than assert hook extraction details. Reuse existing lifecycle tests for shared behaviour and add coverage where the host contract changes.

During implementation, run the affected admin, host, and i18n package suites. Both admin and host package `test` scripts currently run jsdom and node modes; targeted component runs must explicitly use `--mode=jsdom`. Run the repository static gates in their configured order: `pnpm byline:generate:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm knip`. Lint writes files. Browser tests require the migrated/seeded development database and configured credentials described in the testing companion.

For documentation-only changes, run `pnpm docs:check` and `git diff --check`, plus verify this spec's wrapper and relative links directly because the root documentation command scans `docs/**/*.md`, not `specs/`. Implementation tests are future acceptance work, not evidence that this draft has shipped.

## Implementation references

These are current source locations, not a prescribed list of files to edit. The referenced extraction work may move symbols.

| Source | Relevant behaviour |
|---|---|
| `apps/webapp/byline/collections/news/schema.ts` and `media/schema.ts` | `featureImage` targets media; media declares its fields and Draft/Active/Archived workflow. |
| `apps/webapp/byline/collections/news/admin.tsx` and `media/admin.tsx` | News places `featured` and `publishedOn` in the sidebar; media uses the default field layout. |
| `packages/admin/src/forms/form-context.tsx` | Provider-local field state, patch tracking, required-field validation, and deferred uploads. |
| `packages/admin/src/forms/form-renderer.tsx` and `navigation-guard.tsx` | Existing composition, submission, tab IDs, injected guards, and focus recovery. |
| `packages/admin/src/fields/field-renderer.tsx` and `presentation/tabs.tsx` | Field ID derivation and tab-trigger/panel ID helpers. |
| `packages/admin/src/forms/upload-executor.ts` | Field-only upload requests used by ordinary form creation. |
| `packages/admin/src/fields/relation/` and `fields/field-services-types.ts` | Picker session, parent relation caches, summary rendering, and existing host service contracts. |
| `packages/host-tanstack-start/src/server-fns/collections/create.ts` and `save-outcome.ts` | Authenticated creation and safe committed-hook warning responses. |
| `packages/host-tanstack-start/src/integrations/abilities.tsx` and `byline-field-services.ts` | Host ability snapshots and field-service wiring. |
| `packages/core/src/services/document-lifecycle/create.ts`, `internals.ts`, and `packages/core/src/workflow/workflow.ts` | Default-locale enforcement, path derivation and conflicts, initial status through `getDefaultStatus`, and lifecycle hooks. |
| `packages/core/src/services/field-upload.ts` | Alternative upload-endpoint document assembly through `buildDocumentData`. |
| `packages/i18n/src/admin/index.test.node.ts` | Translation-key parity for all bundled locales. |

## Review decisions before implementation

The interaction and lifecycle requirements above are the proposed baseline, not approval of the remaining API and product choices.

| Review item | Proposed baseline | Decision still required |
|---|---|---|
| Initial publication status | Preserve ordinary lifecycle defaults; media normally starts in Draft and the interface explains the public-read consequence. | Confirm that requiring activation through the ordinary editor is acceptable for the first release. Publishing during creation or a per-collection initial-status setting is a separate policy/API change and must include the corresponding authorisation. |
| Creation locale | Use the configured default content locale and explain any difference from the parent's locale. | Confirm the experience for editors working in another locale. Creating directly in that other locale would require changing core lifecycle rules; unconditional inheritance is not a supported option today. |
| Omitted system controls | Derive paths on the server, send no advertised-locale override, and perform no separate tree placement. | Confirm which target workflows can use these defaults. An explicit path override, activation, translation, or placement flow must not be added implicitly. |
| Host capability surface | Inject eligibility/context, creation, and exact-ID display reads into host-independent admin code. | Settle exported names, provider placement, and compatibility for hosts that implement selection only. |
| Receipt and presentation transfer | Always retain both IDs, keep warnings distinct, and allow hydration to recover after picker closure. | Settle the additive response and selection handoff types or shared presentation store; an optional display record alone is insufficient. |

Permission failures, path conflicts, and translation-key parity are defined requirements above, not unresolved choices. This draft preserves current server rules; adopting different publication or locale semantics requires an explicit scope decision before implementation.
