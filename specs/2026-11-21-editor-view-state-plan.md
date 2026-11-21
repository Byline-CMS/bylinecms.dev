---
title: "Editor view state across saves and locale switches — implementation plan"
path: "editor-view-state-plan"
summary: "Deliver the editor view-state specification in three shippable stages, starting with an observation task that fixes where the visit store lives and when a refreshed form can take focus."
---

# Editor view state across saves and locale switches — implementation plan

Companions:

- [Specification](./2026-11-21-editor-view-state-spec.md) — approved revision 2. This plan argues from it. Read both.
- Issues #97 and #98 — closed by stages 1 and 2. Issue #113 is out of scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep tabs, collapsed items, the working position and, in stage 3, the rich-text caret through saves and locale switches for one editing visit.

**Architecture:** The host creates one in-memory view-state store for each editing visit and passes it to `FormRenderer`. `FormRenderer` provides the store through a context, and every form provides a value, `null` when it has no store, so a nested form never reads its parent's store. Widgets read their starting state from the store and write changes to it. A restoration hook in `FormContent` consumes a pending save restoration exactly once, after the outcome of the save is known and the refreshed form is ready.

**Tech stack:** React 19, TanStack Router and Start, dnd-kit, Lexical, Vitest (jsdom and node modes).

**Spec:** `specs/2026-11-21-editor-view-state-spec.md`

## How to read the tasks

Tasks 1 and 2 are written step by step. Task 1 is an observation task, and Task 2 sits inside one package whose files the plan has read. Tasks 3 to 9 cross package boundaries. They are written as **required behaviour → artifacts → red/green tests → gates**. Find their call sites at implementation time with `rg` and `pnpm typecheck`. Both are precise and current, which a line number written here is not.

## Global constraints

- View state never changes `hasChanges`, creates a patch, engages the navigation guard or reaches the server (spec §4.3).
- The `FormProvider` key `${initialLocale}-${versionId}` and the `EditView` and singleton locale keys stay unchanged (spec §4.3).
- View state lives in memory for one editing visit only. No `sessionStorage`, `localStorage` or URL state (spec §5.1).
- Restoration never changes a tab or collapse choice to reveal a target, and it never moves focus after the editor has moved it (spec §4.3, §5.6).
- A remembered address is cut at its first positional `[n]` segment before it is used (spec §5.3).
- Focus never ends on `<body>` after any restoration this plan adds (spec §5.6).
- Forms without a visit store keep today's behaviour exactly. That covers tabs surviving `FormProvider` remounts and `useDocumentReloadRecovery`'s focus recovery. Existing tests for that behaviour stay as written.
- A pending restoration belongs to the action that created it. If you move on first, by focusing, typing or clicking elsewhere, it is discarded and never fires later.
- A rich-text field's focus target is its focusable wrapper, never the content-editable root. Only a pending restoration for the current successful save may let the Lexical plugin place a selection.
- Collection edit views and singleton views both get every behaviour (spec §4.1 goal 5).
- Admin component tests use `*.test.tsx`, run by `pnpm --filter @byline/admin test:jsdom`. Pure logic tests use `*.test.node.ts`, run by `test:node`. The host package uses the same split. `@byline/richtext-lexical`'s default `test` runs only node mode. Run its jsdom tests with `pnpm --filter @byline/richtext-lexical exec vitest run --mode=jsdom`.
- Commits follow `.claude/rules/conventional-commits.md`: `git commit -s`, with the DCO sign-off as the only trailer.
- Every new user-visible string goes in every bundled admin locale. This plan expects none.

## Review focus

Five conditions the spec implies that ordinary tests could miss, most likely first. Each line names the task whose tests pin it.

1. **A second save before the first restoration runs.** You save, then edit and save again quickly. Only the latest save's restoration may run, and a stale one must never fire later. *Task 6: test `a newer save supersedes a pending restoration`.*
2. **The relation picker's nested create form.** It mounts a second `FormRenderer` inside the parent document's tree, and must neither read nor write the parent's store. *Task 3: test `a nested FormRenderer without viewState does not see the parent store`.*
3. **Switching document inside the same route.** Navigating from document A to document B reuses the route component. B must start with defaults. *Task 3: test `changing the document id starts a new visit`.*
4. **A tab set that disappears.** A remembered tab can be hidden by a `condition` after a save. The tab set falls back as it does today, and restoration must not record the fallback as a new choice. *Task 4: test `a hidden remembered tab falls back without overwriting the record`.*
5. **Saving while the target is inside a collapsed item.** You edit a field, collapse its block, and save. The toggle is now the target, since collapsing records it. If an older field target is restored instead, it resolves to hidden content and must fall back to the item's toggle. *Task 6: test `a target inside collapsed content falls back to the item toggle`.*

---

## Stage 0 — observation

### Task 1: Observe the route, remount and focus sequence

Nothing in this task is committed except the findings. The task answers the two questions the spec leaves to the plan (spec §5.2 placement, and §8 "how restoration waits"). Tasks 3 and 6 depend on its answers.

**Files:**
- Modify: `specs/2026-11-21-editor-view-state-plan.md`, in the "Task 1 findings" section at the end of this plan
- Temporary, never committed: `console.debug` instrumentation in `create-collection-edit-route.tsx`, `create-singleton-route.tsx`, `edit.tsx`, `form-renderer.tsx` and `use-document-reload-recovery.ts`

- [ ] **Step 1: Add temporary instrumentation.** Log, with `performance.now()` and a `[vs]` prefix:
  - mount and unmount of `CollectionEditComponent` (the route component), `EditView`, `FormRenderer` and `FormContent`
  - every value of `submission.isBusy`
  - each run of the focus-restore effect in `useDocumentReloadRecovery`, with the element it focused
  - `initialData.versionId` on each `FormContent` render
  - when the post-save `navigate()` promise settles
  - `document.activeElement` and `window.scrollY`, sampled on each `requestAnimationFrame` for 1.5 seconds after Save is activated
- [ ] **Step 2: Start the dev server.** Run `pnpm dev` (check the root `package.json` for the current script). Sign in, and open a `docs` document that has tab sets and blocks.
- [ ] **Step 3: Version-changing save.** Scroll partway down, edit a text field inside a block, click Save. Record the full `[vs]` log. Repeat once using Tab to reach Save and Enter to press it.
- [ ] **Step 4: Path-only save.** Change only the path in the sidebar, click Save, confirm the system-fields dialog. Record the log, and whether `versionId` changed and whether `FormContent` remounted.
- [ ] **Step 5: Locale switch.** Switch locale from the view menu. Record whether `CollectionEditComponent` remounts, which shows whether TanStack Router remounts the route component when `loaderDeps` change. Record where focus and scroll end.
- [ ] **Step 6: Singleton.** Repeat Steps 3 and 5 on a singleton.
- [ ] **Step 7: Write the findings** in "Task 1 findings" below, answering each of these:
  - **F1:** Does the route component survive the post-save navigation, and a locale switch? This fixes the store owner (Task 3): the route component if it survives both, otherwise a provider in the admin shell that ends the visit when the current match stops being this document's edit view.
  - **F2:** For a version-changing save, in what order do these happen: `isBusy` turning false, the navigate settling, the old `FormContent` unmounting, and the new one rendering with the new `versionId`? Name the earliest signal after which the new form's DOM is final. This defines "ready" for Task 6.
  - **F3:** The same for a path-only save, where nothing remounts. Name the ready signal.
  - **F4:** Does the #98 diagnosis hold (spec §3.1)? Did focus briefly land on a form control before reaching `<body>`?
  - **F5:** Which navigations reset scroll, and does `resetScroll: false` on the navigate call stop it without the router's `scrollRestoration` overriding it? Test this once by hand, temporarily.
  - **F6:** How does the host signal that a save has completed? The collection host starts `navigate()` without awaiting it. The singleton host awaits `router.invalidate()`. State which host changes Task 6 needs so that `onSubmit` settles, or the store is told, only once the refreshed data is in place. Also record any differences between the two hosts in F2 and F3.
- [ ] **Step 8: Remove the instrumentation.** Run `git status`. Expected: only this plan file is modified.
- [ ] **Step 9: Commit the findings.**

```bash
git add specs/2026-11-21-editor-view-state-plan.md
git commit -s -m "specs: recorded editor view-state route and focus observations"
```

**Gate:** Tony reviews the findings before Task 3 starts. If F1 to F3 contradict the spec, revise the spec first.

---

## Stage 1 — visit store, tabs and collapse (closes #97)

### Task 2: The view-state store and address helpers

The store is pure TypeScript with no React dependency. It lives in the admin package.

**Files:**
- Create: `packages/admin/src/forms/view-state/editor-view-state.ts`
- Create: `packages/admin/src/forms/view-state/view-state-address.ts`
- Test: `packages/admin/src/forms/view-state/editor-view-state.test.node.ts`
- Test: `packages/admin/src/forms/view-state/view-state-address.test.node.ts`

**Interfaces:**
- Produces, in `view-state-address.ts`:
  - `trustedAddress(path: string): string`. Returns `path` cut before its first positional segment `[<digits>]`, keeping `[id=…]` segments. Returns `''` when the first segment is positional.
  - `isTrustedAddress(path: string): boolean`, true when `trustedAddress(path) === path`.
- Produces, in `editor-view-state.ts`:

```ts
export type TargetRole = 'field' | 'grip' | 'toggle' | 'menu' | `action:${string}`
export interface ViewTarget { path: string; role: TargetRole; offset: number | null }
export type SaveOutcome = 'success' | 'refused'
export interface PendingRestore { saveSeq: number; target: ViewTarget | null; focusWarning: boolean; expectedRevision: number | null }

export interface EditorViewStateStore {
  getTab(tabSet: string): string | undefined
  setTab(tabSet: string, tab: string): void
  isCollapsed(itemPath: string): boolean
  setCollapsed(itemPath: string, collapsed: boolean): void
  getTarget(): ViewTarget | null
  setTarget(target: ViewTarget): void
  clearTarget(): void
  beginSave(): number
  markSaveWarning(): void            // flags the most recent begun save; its restore focuses the warning
  expectRefresh(receipt: { revision: number }): void   // records the most recent begun save's receipt revision (Task 1 F6)
  settleSave(saveSeq: number, outcome: SaveOutcome): void
  takePendingRestore(renderedRevision: number | undefined): PendingRestore | null  // null until renderedRevision >= expectedRevision
  cancelPendingRestore(): void       // the user moved on; nothing pending fires
  subscribe(listener: () => void): () => void
}
export function createEditorViewStateStore(): EditorViewStateStore
```

- [ ] **Step 1: Write the failing address tests.**

```ts
expect(trustedAddress('content[id=a1].body')).toBe('content[id=a1].body')
expect(trustedAddress('content[id=a1].columns[2].text')).toBe('content[id=a1].columns')
expect(trustedAddress('content[2].text')).toBe('content')
expect(trustedAddress('title')).toBe('title')
expect(isTrustedAddress('content[0]')).toBe(false)
```

  Use `parseInstancePath` from `@byline/core` if it exposes segment kinds. Otherwise match `[<digits>]` directly. Do not hand-roll a second path grammar.

- [ ] **Step 2: Write the failing store tests.**
  - `tabs and collapse round-trip`: `setTab('main','content')` makes `getTab('main')` return `'content'`. `setCollapsed('content[id=a]', true)` makes `isCollapsed` return true.
  - `collapse under a positional address is ignored`: `setCollapsed('content[1]', true)` leaves `isCollapsed('content[1]')` false.
  - `a refused save leaves nothing pending`: `const s = beginSave(); settleSave(s, 'refused')` makes `takePendingRestore()` return `null`.
  - `a successful save yields one restoration`: after `setTarget({path:'title',role:'field',offset:120})`, `beginSave()` and `settleSave(s,'success')`, `takePendingRestore()` returns `{ saveSeq: s, target: { path:'title', role:'field', offset:120 }, focusWarning: false }`. A second call returns `null`.
  - `a warning belongs to its own save`: `const a = beginSave(); markSaveWarning(); settleSave(a,'success')` makes `takePendingRestore()` return `focusWarning: true`. A following `const b = beginSave(); settleSave(b,'success')` returns `focusWarning: false`.
  - `cancelling discards a pending restoration`: after a successful `settleSave`, `cancelPendingRestore()` makes `takePendingRestore()` return `null`.
  - `restoration waits for the expected revision`: after `const s = beginSave(); expectRefresh({ revision: 47 }); settleSave(s,'success')`, `takePendingRestore(46)` returns `null` and keeps the restoration pending. `takePendingRestore(47)` returns it with `expectedRevision: 47`. A following call returns `null`.
  - `no receipt means no revision gate`: without `expectRefresh`, `takePendingRestore(undefined)` returns the restoration with `expectedRevision: null`. This is the path for hosts that do not report a receipt.
  - `a newer save supersedes a pending restoration`: `const a = beginSave(); const b = beginSave(); settleSave(a,'success')` makes `takePendingRestore()` return `null`. After `settleSave(b,'success')`, it returns `saveSeq === b`.
  - `subscribe notifies on writes`: a listener is called once for each `setTab`, `setCollapsed` and `setTarget`.

- [ ] **Step 3: Run the tests and see them fail.** Run `pnpm --filter @byline/admin test:node -- view-state`. Expected: FAIL, modules not found.
- [ ] **Step 4: Implement both modules.** The pending restoration copies the target at `beginSave()`, so a later edit during the save does not change what this save restores.
- [ ] **Step 5: Run the tests and see them pass.** Same command. Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add packages/admin/src/forms/view-state
git commit -s -m "feat(admin): added the editor view-state store and address helpers"
```

### Task 3: Provide the store, and own one per visit in the host

**Required behaviour:**
- `FormRenderer` accepts `viewState?: EditorViewStateStore | null`. It always renders `EditorViewStateContext.Provider` with `viewState ?? null`, above the keyed `FormProvider`. A nested `FormRenderer` without the prop therefore shadows its parent with `null` (spec §5.2 isolation).
- `useEditorViewState(): EditorViewStateStore | null` reads the context.
- The collection edit route and the singleton route create a store for each visit at the owner chosen in finding F1. The store is identified by `collection/<path>/<id>` or `singleton/<path>`. A new identity creates a new store. The store is passed to `EditView` or the singleton view, and from there to `FormRenderer` as `viewState`.
- The create view passes nothing.

**Artifacts:**
- Create `packages/admin/src/forms/view-state/editor-view-state-context.tsx`.
- Export the context hook, `createEditorViewStateStore` and the types through `packages/admin/src/react.ts`. Update the exports-parity test, `knip.exports.baseline.json` and `docs-api-surface.ts` if any of them reject the new exports.
- Change `form-renderer.tsx`, `create-collection-edit-route.tsx`, `create-singleton-route.tsx`, `edit.tsx` and `singletons/view.tsx`, or the admin-shell provider if F1 requires it.

**Red/green tests:**
- Admin jsdom, `form-renderer-view-state.test.tsx`: `a nested FormRenderer without viewState does not see the parent store`.
- Host jsdom, in a new `view-state-visit.test.tsx`. Use a real router with memory history, as `chrome/th-sortable.test.tsx` builds one. `save-navigation.test.tsx` mocks both `FormRenderer` and navigation, so its assertions cannot show what survives a real route transition.
  - `the same store survives a save navigation and a locale change`
  - `changing the document id starts a new visit`
  - `leaving to the list and reopening starts a new visit`

**Gates:** `pnpm --filter @byline/admin test`, `pnpm --filter @byline/host-tanstack-start test`, `pnpm typecheck`, `pnpm knip:exports`.

**Commit:** `feat: provided a per-visit editor view-state store to collection and singleton editors`

### Task 4: Tabs read from and write to the store

**Required behaviour:**
- When a store is present, each tab set's selection starts from `store.getTab(set.name)` and writes with `setTab` on a user selection. Without a store, behaviour is unchanged.
- The fallback for a hidden tab stays in `useFormTabs.resolve` and never writes to the store.
- Without a store, the existing `savedTabsRef` fallback above the keyed `FormProvider` stays, so tabs still survive locale and version remounts of `FormProvider`. With a store, the store is the source and `savedTabsRef` is unused.
- Correct the doc comment on `useFormTabs`. It claims the lifted selection survives a locale switch, but that only holds within one `FormRenderer` instance.

**Red/green tests:**
- Admin jsdom: `form-renderer-tab-persistence.test.tsx` passes **unchanged**.
- Admin jsdom: `the remembered tab survives a FormRenderer remount with the same store`. This is the #97 case the old test could not reach.
- Admin jsdom: `a hidden remembered tab falls back without overwriting the record`.

**Gates:** admin `test`, `pnpm typecheck`.

**Commit:** `fix(admin): kept the selected tab across content-locale switches (#97)`

### Task 5: Collapse read from and written to the store

**Required behaviour:**
- `SortableItem` and `StaticItem` take a required `itemPath: string`. Array and blocks fields pass `repeatingItemPath(path, item, index)`.
- `ItemFrame` starts its collapsed state from `store.isCollapsed(itemPath)` and writes with `setCollapsed` on toggle. The store already ignores positional paths (Task 2).
- The only call sites are `fields/array/array-field.tsx` and `fields/blocks/blocks-field.tsx`. Confirm with `rg "<(SortableItem|StaticItem)"`.

**Red/green tests (admin jsdom):**
- `collapsed items stay collapsed after a FormProvider remount`
- `collapsed items carry across a locale remount by item id`
- `an item absent from the new data starts expanded and keeps its record`
- `a collapse under a positional path is not applied after reorder`

**Gates:** admin `test`, `pnpm typecheck`, `pnpm lint`.

**Commit:** `feat(admin): kept collapsed items across saves and locale switches`

**Stage 1 browser gate.** Record the scenario and the observed result in the PR description:
- The #97 reproduction keeps the `Content` tab.
- Collapse two blocks, reorder a third, save. The blocks stay collapsed and the order is kept.
- Open another document, then return. It starts with defaults.

---

## Stage 2 — working target and viewport (closes #98)

### Task 6: Target markers, recording and save restoration

**Required behaviour:**
- **Markers.** Every field's editing control and every item header control carry `data-byline-target="<instance path>"` and `data-byline-role="<TargetRole>"`. Add the markers in the shared field wrapper where one exists, otherwise in each widget, and in `ItemFrame` for `grip`, `toggle` and `menu`. A rich-text field marks a focusable wrapper (`tabIndex={-1}`) around the editor with role `field`, never the content-editable root. Focusing the root could establish a caret before a saved selection has been validated.
- **Recording** (spec §5.4).
  - A form-level `input` or `change` listener resolves the closest marker and calls `setTarget` with `offset = el.getBoundingClientRect().top`.
  - Structural handlers call `setTarget` explicitly:
    - move → the moved item's `grip`
    - toggle → the item's `toggle`
    - add → the new item's first field, otherwise its header
    - remove → the next item's header, otherwise the previous item's, otherwise the add control
  - Focus alone never records.
  - Controls without a value-change DOM event (pickers, uploads) call `setTarget` from their change handler. Find these with `rg` for widgets that call `setFieldValue` without a native input.
- **Save lifecycle.**
  - `useFormSubmission` calls `store.beginSave()` immediately before it calls `onSubmit`: after validation, after uploads and after the system-fields confirmation. A validation failure, an upload failure or a cancelled confirmation therefore never begins a save and leaves nothing pending.
  - It calls `settleSave(seq, 'success')` when `onSubmit` resolves and `'refused'` when it rejects.
  - A returned committed-hook result resolves, so it restores as a success.
  - In the thrown committed path, the host calls `store.markSaveWarning()` before `reloadDocument()`, so the warning decision belongs to that save attempt.
  - Restoration never reads `mutationIssue`. It stays `'committed'` after later saves, because `useDocumentMutationState` never clears it, and reading it would send a later ordinary save back to the old warning.
  - Both hosts call `store.expectRefresh({ revision })` beside each `mutation.adopt(result)` on the save path (Task 1 F6, readiness contract step 1).
- **Moving on cancels.** While a restoration is pending, `FormContent` calls `cancelPendingRestore()` on the first `focusin` outside the control that held focus when the save started, and on the first `keydown` or `pointerdown`. Focus and scroll then stay where you put them.
- **Restoration hook.** `useRestoreAfterSave(formRef)` in `FormContent` runs only when a store is present. Without a store, `useDocumentReloadRecovery`'s existing behaviour stays in charge. With a store, it follows the readiness contract in Task 1 F6. It calls `takePendingRestore(initialData.revision)` on each render until that returns a restoration, then waits for the target to be ready (contract step 3), and then:
  - When `focusWarning` is true, focus the warning and scroll it into view.
  - Otherwise resolve the target (below), focus it with `preventScroll`, and scroll so its top sits at `offset`. When `offset` is null or outside `[0, innerHeight - 40]`, or the target resolved to a fallback, use `scrollIntoView({ block: 'nearest' })`.
  - When there is no target, focus the heading.
- **Resolution** (spec §5.6). `resolveRestoreTarget(form: HTMLElement, target: ViewTarget): HTMLElement`, in `packages/admin/src/forms/view-state/resolve-target.ts`, applies `trustedAddress` and then this fallback chain:
  1. the exact control
  2. the item's toggle, then its grip
  3. the field's first focusable control
  4. the active tab trigger
  5. the heading

  It walks up by trimming the last path segment until a marker matches. A control is usable when it is connected, not disabled, not inside an `inert` subtree and not inside `.byline-sortable-content-hidden`.
- The form heading gets `tabIndex={-1}`.
- `useDocumentReloadRecovery` keeps its refused-save behaviour in every form. It keeps its success-path behaviour in forms without a store. In forms with a store, `useRestoreAfterSave` owns success, and the old success path stands down.
- The post-save `navigate()` in `edit.tsx` and `singletons/view.tsx` passes `resetScroll: false`, or the alternative confirmed in F5.

**Red/green tests:**
- Admin node, `resolve-target.test.node.ts`, over a hand-built DOM, one case per fallback level. Include:
  - `a target inside collapsed content falls back to the item toggle`
  - `a target under an unselected tab falls back to the active tab trigger`
  - `a positional target resolves to its identifiable parent`
- Admin jsdom:
  - `edit then click Save: the field has focus after remount` (the click path)
  - `edit A, focus two other controls, save: A has focus`
  - `reorder then save: the moved grip has focus`
  - `refused save: no restoration, existing focus behaviour`
  - `validation failure, upload failure and cancelled confirmation leave nothing pending`
  - `a delayed refresh after the user moves focus elsewhere: no restoration, focus and scroll unchanged`
  - `a form without a store keeps the existing focus recovery` (existing `form-renderer-submit.test.tsx` passes unchanged)
  - `hasChanges is false after restoration`
- Host jsdom:
  - `thrown committed path: the warning has focus and is visible`
  - `a thrown committed warning followed by an ordinary successful save in the same visit: the second save focuses the working target, not the warning`
  - `path-only save restores focus to the path control exactly once, after confirmation, without a remount`
  - `delayed content: the old instance never consumes; restoration waits until the rendered revision reaches the receipt`
  - `surviving metadata: a path-only save re-rendering the same instance with the new revision consumes once`
  - `a target whose block populates one effect after mount is focused, not replaced by a fallback`
  - `a target whose item is gone from the saved data falls back immediately, without waiting out the bound`
  - `a returned committed-hook-failed result restores like success`, using the real result shape from `hasCommittedDocumentHookFailure`'s fixture or the server function's type

**Gates:** all package `test` scripts touched, `pnpm typecheck`, `pnpm lint`, `pnpm knip`.

**Commit:** `fix(admin): returned focus to the working target after save (#98)`

### Task 7: Focus and scroll for the other navigations

**Required behaviour (spec §5.7):**
- Action controls carry `data-byline-role="action:<name>"`: `action:status`, `action:unpublish`, `action:schedule`, `action:copy-locale` and `action:delete-locale`. The locale selector in `ViewMenu` carries `action:locale`.
- Before each in-visit navigation, the host records an action restoration in the store: the starting control's role, plus a viewport anchor from the topmost visible marker and its offset. Add `setActionRestore` / `takeActionRestore` to the store, following the save pattern. Extend Task 2's tests for it.
- After the remount, restoration focuses the action control when it exists, otherwise the Task 6 chain from the working target. It re-anchors the topmost marker.
- A locale switch, copy to locale and delete locale record their intended action before navigating, without clearing anything. The working target and any rich-text selection are cleared only when the locale has actually changed, when the new form consumes that action restoration. A locale switch focuses `action:locale`.
- Every in-visit navigation in `edit.tsx` and `singletons/view.tsx` passes `resetScroll: false`: status, unpublish, schedule (arm, confirm, cancel), copy to locale, delete locale and locale change. Discard after a conflict still does a full reload, unchanged.
- A navigation cancelled through the guard's Stay leaves the store untouched. The recorded intent is discarded on Stay, and the working target, selection and dirty state remain.
- Action restorations follow the same "moving on cancels" rule as save restorations.

**Red/green tests (host jsdom):**
- `after a locale switch the locale selector has focus`
- `after a status change the status control has focus and scroll is not reset`
- `a dirty locale switch cancelled with Stay keeps target, dirty state and visit`
- `copy to locale clears the working target`

**Gates:** as Task 6.

**Commit:** `feat: kept focus and scroll position across in-editor navigations`

**Stage 2 browser gate** (spec §7.2). Record in the PR:
- The headline demonstration: collapse two, reorder a third, edit inside it, click Save. You can keep typing in place.
- The same demonstration using only the keyboard, tabbing through at least two controls to Save.
- A path-only save, a status change and a locale switch, each showing where focus and scroll ended.
- A keyboard reorder through dnd-kit's keyboard sensor, then a save. Focus is on the moved grip, and a second keyboard reorder works from there (spec §6).

---

## Stage 3 — exact rich-text selection

### Task 8: Record and restore the root-editor selection

**Required behaviour (spec §6, §7.3):**
- Admin exports `useRichTextSelectionMemory(path: string)`, returning:

```ts
{
  record(sel: StructuralSelection, contentHash: string): void
  take(): { sel: StructuralSelection; contentHash: string } | null
}
```

  It is backed by store methods `setSelection` / `takeSelection`, and only active when `path` is the current working target. `take()` returns a selection only while the pending restoration for the current successful save is being consumed, which authorizes the plugin. At any other time it returns `null`.
- Any edit inside a nested editor (caption or admonition) clears the field's recorded root selection. A nested edit records the same field path as the working target, so an older root selection must not survive it.
- Define `StructuralSelection = { anchor: { path: number[]; offset: number }; focus: { path: number[]; offset: number } }` in the admin view-state module. Child-index paths start at the root. Never use node keys.
- `@byline/richtext-lexical` adds a root-editor-only plugin that:
  - Records the selection on selection change while the field is the working target, through `registerUpdateListener`, reading only.
  - On restore, the wrapper already has focus from stage 2. The plugin places the caret only after `ApplyValuePlugin`'s baseline waiter has set the baseline for this value, and only when the value was not refused, null or adapted and the content hash equals the recorded one. It applies the selection with a selection-only `editor.update` outside any active update. It must never reach the form's `onChange`.
  - Cancels on `focusin` elsewhere, `keydown`, `pointerdown`, a new navigation, or a bound of 1000 ms. Once cancelled it never takes focus back.
- Expose the baseline readiness that the plugin needs from `ApplyValuePlugin` without changing its emission gate. The plan's preferred shape is a callback or event fired where the waiter sets `hasNormalizedBaselineRef.current = true`.
- Nested caption and admonition editors never record.

**Red/green tests (richtext-lexical jsdom):**
- `caret midway, save, type one character: lands at the saved offset, form clean before typing, dirty after`
- `changed content: no caret placed, field wrapper focused`
- `adapted or refused content: no caret placed`
- `focus moves before the baseline is ready: no caret, focus not taken back`
- `nested caption selection is not recorded`
- `edit the root paragraph, then edit a nested caption, then save: no caret replayed, wrapper focused`
- `no pending successful save: take() returns null and no caret is placed`

**Gates:** `pnpm --filter @byline/richtext-lexical exec vitest run --mode=jsdom`, then its `test`, plus `pnpm typecheck` and `pnpm lint`.

**Commit:** `feat(richtext-lexical): restored the caret position after save`

**Stage 3 browser gate** (spec §7.3): a long field, a field inside a block, and a nested caption that must fall back.

### Task 9: Documentation and release notes

**Required behaviour:**
- Add a short section to the admin UI docs on what the editor remembers during a visit and what starts a new visit. Use the `/document` workflow.
- Add a changeset covering the affected packages.
- Close #97 after stage 1 ships and #98 after stage 2 ships.

**Gates:** `pnpm docs:check`, `git diff --check`.

**Commit:** `docs: described editor view state across saves and locale switches`

---

## Revision log

- **2026-11-22, revision 2.** After review:
  - Forms without a store keep their existing tab and focus behaviour, and their tests stay unchanged.
  - The save-warning decision is bound to the save attempt through `markSaveWarning`, not read from `mutationIssue`.
  - `beginSave` moved to just before `onSubmit`.
  - Added F6 for host save-completion signals.
  - Pending restorations cancel when the user moves on.
  - Locale switches clear the target only once the locale has changed.
  - The rich-text wrapper is the focus target, caret placement needs an authorizing successful save, and a nested edit clears the root selection.
  - Corrected the item-frame call sites and the host test harness.

## Task 1 findings

Observed on 2026-11-22 against the local dev server (`pnpm dev`, React development build with StrictMode), using temporary `[vs]` instrumentation and a `requestAnimationFrame` sampler of `document.activeElement` and `scrollY`. The instrumentation has been removed. Pages used: a docs document (`Details` and `Content` tabs, one richtext block), the "Test Page" page (three tabs, blocks, inline image) and the `site-settings` singleton. Times are `performance.now()` in milliseconds. StrictMode doubles each mount (`unmount`/`mount` pairs a few milliseconds apart). That doubling is a development artifact and is omitted below.

**F1 — store owner.** The route component survives both navigations, for collections and singletons. No `unmount RouteComponent` was logged after a save or a locale switch.

```
collection save:    …calling navigate → new versionId render → unmount FormContent / mount FormContent   (EditView, FormRenderer, RouteComponent untouched)
collection locale:  unmount EditView, unmount FormRenderer, unmount FormContent → mount …                 (RouteComponent untouched)
singleton locale:   unmount SingletonView, unmount FormRenderer, unmount FormContent → mount …            (RouteComponent untouched)
```

The visit store can therefore be owned by the route component (`CollectionEditComponent`, `SingletonRouteComponent`), keyed by document identity. No admin-shell provider is needed. Task 3 must still start a new visit when the `id` param changes inside the same route component (Review focus 3).

**F2 — ready signal, version-changing save, collection.** `isBusy` turns false before the new data arrives, because `edit.tsx` starts `navigate()` without awaiting it.

```
49585 isBusy true
49732 save: onSubmit success, calling navigate
49769 recovery restore effect {target: BUTTON#contentLocale, originalCanReceiveFocus: false}
49781 isBusy false
49895 render FormContent {versionId: <new>}
49911 unmount FormContent → mount FormContent
```

The new version renders, in a new `FormContent` instance, about 130 ms after `isBusy` turned false. At the moment `isBusy` turns false, a version-changing save cannot be told apart from a path-only save. Both are idle, and both still render the version the save started from. Readiness must therefore come from the save's receipt (F6), not from `isBusy` or a mount.

**Target availability after the remount.** This was measured separately, with a `MutationObserver` and `requestAnimationFrame` probe on the docs document. The target was the "Constrained Width" checkbox inside the block, after a content save from y=600.

```
  32 form=old inert=true  items=1 target=1213 sh=2004 y=600 rev=46
 208 form=old inert=false items=1 target=1213 sh=2004 y=600 rev=46
 403 form=NEW inert=false items=1 target=1813 sh=2004 y=0   rev=47
```

At the first observable DOM change after the remount, the new form, its block item and the nested target were all present, and the form was not `inert`. The scroll position had already been clamped to 0. **Limitation:** this is one observation on one document. `BlocksField` and `ArrayField` populate their items from an effect, and rich-text and relation widgets can render later still. So the form's mount is **not** a guarantee that a nested target exists. Task 6 must prove that the target is ready before consuming the restoration or falling back (see the readiness contract in F6).

**F3 — ready signal, path-only save.** The `versionId` is unchanged and nothing remounts.

```
90940 isBusy true
91033 save: onSubmit success, calling navigate
91077 isBusy false            (no further FormContent mount)
```

A repeat run read the router's loader data. The revision went from 16 to 17, with the `versionId` unchanged and the form element unchanged. The new revision reached the loader data about 160 ms after `inert` was removed. The surviving form therefore re-renders with new metadata after `isBusy` has already turned false. The old restore effect did not run at all. When the save went busy, focus was on the system-fields dialog's "Save Changes" button, which `captureFocusBeforeBusy` treats as outside the form, so nothing was captured. Focus ended on `<body>` when the dialog closed.

**F2/F3 for the singleton.** `singletons/view.tsx` awaits `router.invalidate()`, so the new data has arrived before `isBusy` turns false. The remount follows about 25 ms later.

```
21455 isBusy true
21529 singleton: invalidate start
21633 singleton: invalidate settled
21654 isBusy false
21666 render FormContent {versionId: <new>}
21680 unmount FormContent → mount FormContent
```

**F4 — the #98 diagnosis holds, and is wider than the issue says.** Every observed save path ended with focus on `<body>`, by different routes. In the version-changing paths, the old restore effect focused a control: the locale selector as a fallback, or, for Enter in a field, the original input. The remount then removed that control. The path-only save never remounted and never attempted a restore.

| Path | Focus sequence |
| --- | --- |
| Click Save (docs) | `Save` → `BODY` (form `inert`) → `BUTTON "English"` (old fallback: the locale selector) → `BODY` at remount |
| Tab to Save + Enter (page) | identical to the click path |
| Enter in the Title field (page) | `INPUT[name=title]` → `BODY` (`inert`) → `INPUT[name=title]` (restored) → `BODY` at remount |
| Path-only save via the confirmation dialog | `Save Changes` → `BODY`, no restore attempted |
| Singleton click Save | `Save` → `BODY` → `BUTTON "English"` → `BODY` at remount |

The Enter-in-field path, which `form-renderer-submit.test.tsx` models and passes, is also broken in the real host. It restores the input first and then loses it to the remount. The click and Tab-and-Enter paths fall back to the locale selector, because the Save button is disabled. The locale selector is the first focusable element in the form, because `headerSlot` renders inside it.

**F5 — scroll.** There are two separate causes.

1. *Save.* Scroll drops to 0 at the `FormContent` remount even with `resetScroll: false`, and no `scrollTo` call is made. With `body` `min-height` pinned to the pre-save height, scroll stayed at 400 through the save. That held both with and without `resetScroll: false`. The cause is a transient height collapse while the new `FormContent` mounts, and the browser clamps the scroll position. The router does not reset scroll for the same-URL post-save navigation. Restoration therefore re-anchors after the remount (Task 6). `resetScroll: false` on the save navigation is harmless but not required.
2. *Locale switch.* With the height pinned, `router.navigate({ search: { locale } })` still scrolled to the top. The scroll was smooth, starting about 190 ms in, because `html` has `scroll-behavior: smooth`. Passing `resetScroll: false` kept scroll at 400. Every locale-changing navigation needs `resetScroll: false` (Task 7).

`html { scroll-behavior: smooth }` also means that restoration must scroll with `behavior: 'instant'`. Otherwise it animates, and the animation can be cancelled by the user's next input.

**F6 — host save-completion signals.**

Neither host's completion signal is enough on its own:
- **Collection** (`edit.tsx`): `onSubmit` resolves before the refreshed data arrives.
- **Singleton:** the new version renders about 30 ms *after* `router.invalidate()` settles (21633 → 21666).

Awaiting a router promise therefore proves nothing. Every successful save does return a receipt carrying `revision`, and also `documentVersionId` when a version was created. Both hosts already pass it to `mutation.adopt(result)`. The loaded document carries `revision`, and the observations confirm that it advances for content saves (46 → 47) and for path-only saves (16 → 17).

**Readiness contract (replaces "isBusy false" and "new mount").**

1. **Expect.** On a successful save, the host calls `store.expectRefresh({ revision })` with the receipt's revision, where it already calls `mutation.adopt(result)`. This covers a normal result, a returned committed-hook result and the thrown committed path, whose details also carry the revision. This is a small host change in both `edit.tsx` and `singletons/view.tsx`. Task 2 adds `expectRefresh` to the store.
2. **Data ready.** A `FormContent` instance may consume the pending restoration only once its rendered `initialData.revision` is at least the expected revision. For a version-changing save, the old instance never renders the new revision: the `FormProvider` key changes in the same render that delivers it, so only the new instance can qualify. For a path-only save, the surviving instance qualifies when it re-renders with the new metadata. Either case covers delayed content, because nothing happens until the revision arrives.
3. **Target ready.** Once the data is ready, resolve the target. If its marker is absent, decide which of two cases applies before falling back:
   - **Genuinely missing.** Some item on the target's trusted path is no longer in the form store's value for its parent array (by `_id`), or the field no longer exists in the schema. Fall back immediately (spec §5.6).
   - **Still mounting.** The data contains the item but the DOM does not yet. Retry on each animation frame until the marker appears and is usable (connected, not `inert`, not in hidden content). Stop after a bound with no further DOM mutation inside the form; the plan proposes 30 frames or 500 ms, whichever comes first. Then fall back.
4. **Cancellation still applies** while waiting in steps 2 and 3. Focusing, typing or clicking elsewhere discards the restoration (Task 6).

Task 6's tests add two cases:
- *delayed content*: the receipt arrives, and the rendered revision lags by several renders
- *surviving metadata*: a path-only save re-renders the same instance with the new revision

They also cover a target whose block populates one effect after the mount.

**Other observations.**

- Tab selection survived every save, as the spec's revision 2 says. It was lost on every locale switch (#97 confirmed for collections and singletons).
- The docs document's status bar changed from "Published" to "Draft, a published version is currently live" after the observation saves. Each save created a version. The test values were restored afterwards.
