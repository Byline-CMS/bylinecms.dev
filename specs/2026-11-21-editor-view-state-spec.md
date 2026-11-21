---
title: "Editor view state across saves and locale switches — specification"
path: "editor-view-state-spec"
summary: "Keep the document editor's tabs, collapsed items and working position for the length of one editing visit, so a save or a content-locale switch no longer resets the layout."
---

# Editor view state across saves and locale switches — specification

Companions:

- Implementation plan — to be written as `2026-11-21-editor-view-state-plan.md` once this specification is settled.
- Issue #97 — tab selection resets when switching content locale.
- Issue #98 — focus is lost to `<body>` after saving with the Save button.
- Issue #113 — inline warning parity for a returned committed-hook result, out of scope here.
- [Admin UI](../docs/09-admin-ui/index.md) — the form, field and layout components this work touches.
- [Path grammar](../docs/03-architecture/04-path-grammar.md) — the instance-path syntax, including `[id=…]` item selectors, used to address remembered targets.

Date: 2026-11-21. Status: approved, revision 2 (2026-11-22).

## 1. Purpose

You open a document, collapse the blocks you are not working on, move a block into
place, edit a paragraph inside it and click Save. Today every block is expanded
again, the page scrolls to the top and keyboard focus is on `<body>`. You have to
find your place and rebuild the layout before you can continue. Switching the
content locale also expands every block and returns every tab set to its first
tab.

This specification makes the editor remember how you had arranged it for as long
as you keep editing that document. After a save you continue in the same block,
with the same tabs and collapsed items, at roughly the same place on screen.
After a locale switch you see the same arrangement in the other language, and
focus stays on the locale switcher.

The first demonstration of success is that workflow. Collapse two blocks, reorder
a third, edit inside it and click Save. You should be able to keep working in that
block without scrolling back or reopening anything. The same must hold when you
reach Save using only the keyboard.

## 2. Vocabulary

**Editing visit.** The period from opening one document in the edit view to leaving
it. A save, a status change, scheduling and a content-locale switch stay within the
visit. A full page reload, navigating to another document, or navigating to
another view (the list, history or API view) and returning starts a new visit.
Discarding changes after a conflict currently performs a full page reload, so it
also starts a new visit. Creating a document and being redirected to its edit view
starts a new visit.

**View state.** What the editor remembers during a visit: the selected tab in each
tab set, which array and block items are collapsed, the working target and its
viewport offset. View state holds no field values.

**Working target.** The control where you last did editing work, recorded as a
stable address (section 5.3). After a save, focus returns to it.

**Viewport offset.** The working target's vertical distance from the top of the
viewport, recorded when the target is set. Restoration uses it to put the target
back at roughly the same place on screen.

**Remount.** React discarding a component subtree and building a new one.

## 3. Current behaviour and causes

The editor keeps its layout choices in component state, and saves and locale
switches throw that state away by remounting parts of the editor at two levels.

### 3.1 After a save (#98, and the collapse reset)

`EditView.handleSubmit` in `packages/host-tanstack-start/src/admin-shell/collections/edit.tsx`
calls `navigate()` to the same route after a successful save, and the loader
fetches the document again. `FormRenderer` keys `FormProvider` on
`${initialLocale}-${versionId}`. When the save created a new version, the new
version ID remounts `FormContent` and every field widget under it. As a result:

- Collapsed state lives in `useState` inside `ItemFrame`
  (`packages/admin/src/fields/sortable-item.tsx`), so every item opens again.
- Tabs survive. `FormRenderer` is not remounted on a save, and its `savedTabsRef`
  outlives the `FormContent` remount.
- Focus restoration in `useDocumentReloadRecovery`
  (`packages/admin/src/forms/use-document-reload-recovery.ts`) runs inside the
  `FormContent` instance that the remount then discards. Even when it moves focus
  correctly, the element it focused is removed, and focus falls to `<body>`. This
  diagnosis fits the issue's observed log but has not yet been confirmed in a
  browser. The plan's first task confirms it.
- `navigate()` resets scroll by default, so the page returns to the top.
- When you click Save, the element captured before the save is the Save button,
  which becomes disabled once the form is clean.

A save that changes only the path or the advertised locales sends no content
patches and may keep the same version ID. The form then survives the save without
a remount. Restoration must therefore not depend on a remount happening
(section 5.5).

`packages/admin/src/forms/form-renderer-submit.test.tsx` passes because it never
remounts. Saves started by pressing Enter in a field are probably affected in the
real host as well.

### 3.2 After a locale switch (#97)

The edit route renders
`<EditView key={`${collection}/${id}/${locale}`}>`
(`packages/host-tanstack-start/src/routes/create-collection-edit-route.tsx`), and
the singleton route does the same with `${singleton}/${locale}`
(`create-singleton-route.tsx`). A locale switch therefore remounts `EditView`,
which includes `FormRenderer` and its `savedTabsRef`, so tabs and collapse are
both lost.

The key was added deliberately in `f6575b25` (required document revisions). It
resets `useDocumentMutationState` (the revision being observed and any frozen
conflict) for each document and locale. This specification keeps it.

The locale selector is rendered by `ViewMenu`, which the host passes into
`FormRenderer` as `headerSlot`. The remount therefore destroys and recreates the
selector, along with the focus it held.

## 4. Goals, non-goals and anti-goals

### 4.1 Goals

1. Within one editing visit, the selected tab in each tab set and the collapsed
   state of each array and block item survive saves, status changes, scheduling
   and locale switches.
2. After a successful save, focus returns to the working target once, and the
   target appears at roughly the same place in the viewport. This holds whether
   the form remounted or survived.
3. After a locale switch, tab and collapse choices carry across for every item that
   exists in the new locale, and focus returns to the locale selector.
4. In a rich-text field, the exact caret position survives a save when the field's
   content came back unchanged (stage 3, section 7).
5. Collection edit views and singleton views both behave this way.

### 4.2 Non-goals

- View state does not survive a full reload, a new visit, or the round trip through
  full-page preview. A later change may keep view state in `sessionStorage` for the
  preview round trip, as the list return state already does, if editors expect
  "back from preview" to resume their work.
- The create view is unchanged. Its redirect to the edit view starts a new visit.
- Lexical's undo history is still lost when a save remounts the form. Keeping it
  would mean applying the saved version in place instead of remounting (approach A
  in section 5.1).
- Scroll positions inside nested scroll containers, open dropdowns, open modals and
  picker state are not remembered.
- The committed-hook warning is not changed. A save whose hooks failed after the
  data was stored can be reported in two ways. A thrown error establishes the
  inline `mutationIssue` warning. A returned `committed-hook-failed` result shows
  only a toast. Making the returned result show the same inline warning is a
  separate change to the warning interface, tracked in issue #113.

### 4.3 Anti-goals

The work fails, even if it otherwise behaves as described, if any of these happen:

- **Restoration marks the form dirty.** Restoring tabs, collapse, focus or a caret
  must never change `hasChanges`, create a patch, or engage the navigation guard.
- **View state reaches the data path.** View state must stay separate from form
  values, patches, revisions, conflict handling and `useDocumentMutationState`. It
  is never sent to the server.
- **The caret jumps.** Restoration must never reproduce the bug that caused
  `AutoFocusExtension` to be removed from `default-extensions.ts`, where the caret
  jumped to the end of a rich-text field after a tab switch or save. When the
  caret cannot be placed confidently, restoration does not place it.
- **Restoration fights the editor.** Restoration never changes a tab or collapse
  choice the editor made, and it never moves focus after the editor has moved it.
- **Restoration lands on the wrong item.** Focus, collapse or a caret must never be
  applied to a neighbouring item because a positional address now names it
  (section 5.3).
- **The remounts are removed.** The `FormProvider` version key and the
  `EditView` locale key stay. Their resets protect correctness.

## 5. Design

### 5.1 Approaches considered

**A. Apply the saved version in place instead of remounting.** Everything would
survive automatically, including Lexical's undo history. The form would have to
adopt the server's version as its new baseline without a remount, including values
that server normalization or hooks changed, and push them into every live widget,
including rich-text editors. It does nothing for locale switches, which load
different data. Rejected for now as higher risk with less coverage.

**B. Keep the remounts and hold view state above them.** One mechanism covers saves
and locale switches, it leaves the data path untouched, and it can ship in stages.
**Chosen.**

**Lifetime.** Keeping view state in memory for one editing visit was chosen over
`sessionStorage`. It gives #97 and #98 a clear scope, and a reload stays a reliable
way to start fresh. `sessionStorage` remains an option for the preview round trip
(section 4.2).

### 5.2 The visit store

A view-state store exists for each editing visit. It is owned by the host and
provided to the admin form through a React context. The host owns the store
because only the host knows when a visit starts and ends. The admin package
defines the context, the store contract and the widgets' use of it, so other hosts
can supply their own store. When no store is provided (the create view, admin
user and role screens, and the relation picker's nested create form), widgets
behave as they do today.

Requirements for the store:

- **Lifetime.** It is created when a visit starts and discarded when the visit ends
  (section 2). It must survive every same-document navigation that stays within the
  visit: the post-save `navigate()`, status changes, scheduling and the locale
  navigation. It must not survive navigation to another document or another view.
  A navigation the editor cancels, for example by choosing Stay in the
  unsaved-changes guard, leaves the visit and all of its state untouched.
- **Placement.** It must live above the keyed `EditView`. Whether the route component
  itself survives a locale change depends on TanStack Router's remount behaviour
  when `loaderDeps` change, which has not been verified. The store's owner must
  either be shown to survive these navigations or sit higher, at a provider that
  ends the visit when the current match stops being this document's edit view. The
  plan's first task establishes which.
- **Identity.** A visit is identified by view kind plus document identity, so
  `collection/<path>/<id>` or `singleton/<path>`. The locale is not part of the
  identity.
- **Isolation.** A nested form, such as the relation picker's create view, must not
  read or write the parent document's store.
- **Contents.** The store holds only the state in section 5.3. It holds no field
  values and no patches, and changes to it never re-render the whole form.

### 5.3 What the store records

| State | Address | Written when |
| --- | --- | --- |
| Selected tab | Tab set name | The editor selects a tab |
| Collapsed items | Item instance path | The editor collapses or expands an item |
| Working target and viewport offset | Control address (below) and pixels from the viewport top | The editor edits a value or performs a structural action (5.4) |
| Rich-text selection | Field instance path plus a structural selection (7.3) | The selection changes inside a rich-text field that is the working target (stage 3) |

**Addresses.** Items are addressed by their full instance path, built with
`repeatingItemPath()` (`packages/admin/src/forms/repeating-items.ts`). For example,
`content[id=a1].columns[id=b2]`. Item IDs come from stored `item_id`
(`storage-restore.ts`) and are stored once with locale `'all'`
(`storage-flatten.ts`). They stay the same through saves and reorders, and they
identify the same item in every locale. Items added in the editor receive a
client-side `_id` that is saved, so they stay addressable after the save.

**Positional segments are never trusted for restoration.** Items without a
canonical ID, such as legacy data or unsaved create defaults, get positional `[n]`
segments. After a removal or reorder, a positional address can name a different,
perfectly usable item, so a fallback would never notice the mistake. Restoration
therefore cuts every remembered address at its first positional segment and uses
the nearest identifiable ancestor: the closest `[id=…]` item or the containing
field. Collapse records under a positional segment are not applied. This needs no
tracking of structural changes, and it cannot land on a neighbour.

The working target is an instance path plus a control role, either the field's
editing control or one of an item's header controls (`grip`, `toggle` or `menu`).
DOM IDs cannot address targets because `useScopedDomId` derives them from
`useId`, which changes on remount. Widgets therefore expose a stable,
scope-independent marker, such as a data attribute carrying the instance path and
role, that restoration can query inside the current form. The plan chooses the
exact marker.

### 5.4 The working target: last edit or structural action

The working target records the last thing you changed. Focus alone never records a
target. If you edit paragraph A, then press Tab through fields B and C to reach
Save, the target stays at A.

| Action | Working target becomes |
| --- | --- |
| Changing a field's value (typing, picking, toggling) | That field's control |
| Reordering an item (pointer or keyboard) | The moved item's grip |
| Collapsing or expanding an item | That item's toggle |
| Adding an item | The new item's first field, otherwise its header |
| Removing an item | The next item's header, otherwise the previous item's, otherwise the parent field's add control |
| Focusing a control without changing it | No change |
| Selecting a tab | No change |
| Save, status, locale selector, document actions, modals | No change |

The viewport offset is recorded with the target, at the moment of the action, and
updated as you keep editing the same control. It is not sampled when the save
starts, because by then tabbing to Save may have scrolled the target off screen.

Sidebar document controls (path, available locales and tree placement) count as
fields when you change them.

### 5.5 Restoring after a save

Restoration is tied to the Save action and its outcome, not to a remount. When a
save starts, the store holds a pending restoration for that save. The outcome
settles it, and it runs at most once:

| Outcome | Result |
| --- | --- |
| Success, including a returned `committed-hook-failed` result | Restore (below) |
| Thrown committed-hook error (`mutation.report(err)` returns `'committed'`) | Restore tabs and collapse. Focus goes to the inline `mutationIssue` warning, as today |
| Refused (validation, conflict, network) | No restoration. The form did not remount, and the existing `useDocumentReloadRecovery` behaviour stays. A refused save preserves dirty state. Validation and ordinary request failures allow a retry. A conflict blocks further saves through `mutationsBlocked` and focuses its warning |

Restoration on success:

1. Each tab set starts on its remembered tab, falling back as it does today when
   that tab is hidden by a condition. Each item starts in its remembered collapsed
   state, and items with no record start expanded. When the form remounted, this
   happens through initial state, not an effect, so the default layout never
   flashes before the remembered one. When the form survived, nothing has changed.
2. Once the saved version's fields have rendered, the working target is resolved
   (section 5.6) and focused with `preventScroll`.
3. The page scrolls so the resolved element's top sits at the recorded viewport
   offset. When that offset is outside the viewport, or the target resolved to a
   fallback, the element is scrolled into view instead.
4. The post-save `navigate()` stops resetting scroll (`resetScroll: false`, or an
   equivalent that keeps the router's scroll restoration from interfering).

When restoration focuses a warning, the warning must end up visible. Its
visibility takes precedence over the recorded viewport offset.

When no working target exists, restoration focuses the form heading. A save always
follows a change, and every change records a target, so this should happen rarely.

A path-only or advertised-locales-only save goes through Save and the
system-fields confirmation dialog like any other save, and follows these rules.

### 5.6 Resolution and fallbacks

Restoration never changes the tab or collapse state to reveal a target. After the
address is cut at any positional segment (section 5.3), restoration uses the first
of these that is usable:

1. The exact control.
2. The containing item's toggle, then its grip.
3. The containing field's first focusable control.
4. The active tab trigger, when the target sits under an unselected tab.
5. The form heading. This needs a programmatic focus target (`tabIndex={-1}`).
   Focus never ends on `<body>`.

A control is usable when it is connected, not disabled, not `inert`, and not
inside a collapsed item's hidden content.

### 5.7 Other navigations within the visit

| Navigation | Tabs and collapse | Scroll | Focus |
| --- | --- | --- | --- |
| Status change, unpublish, scheduling (arm, confirm, cancel) | Restored | Kept: the topmost visible field or item is re-anchored at its offset | The control that started the action, when it exists after the remount. Otherwise the 5.6 fallbacks from the working target |
| Locale switch | Restored where the same items exist (below) | Kept, as above | The locale selector |
| Copy to locale, delete locale (both change the locale) | As a locale switch | As a locale switch | The control that started the action when it exists, otherwise the locale selector |
| Discard after a conflict | The visit ends with a full page reload (section 2) | — | — |

None of these navigations resets scroll to the top. The control that started an
action is addressed with the same stable marker as other targets (section 5.3),
using a role such as `action:status`.

On a locale switch:

1. Tabs and collapsed items start as remembered, by tab set name and item path.
   Items that do not exist in the new locale's data start expanded. Their records
   stay in the store in case you switch back.
2. The working target and any rich-text selection are cleared. A caret position
   recorded in one language is never replayed in another.
3. A locale switch blocked by the unsaved-changes guard and cancelled with Stay
   changes nothing. The working target, caret, dirty state and visit all survive.

## 6. Delicate areas

**Lexical value application.** The rich-text field receives stored content through
`ApplyValuePlugin` (`packages/richtext-lexical/src/field/apply-value-plugin.tsx`).
It normalizes the value and may report it as adapted or refuse it. It applies the
value with `setEditorState(…, { tag: APPLY_VALUE_TAG })` and only then establishes
the emission baseline, through a waiter. For refused content it deliberately leaves
the baseline unset, and for a null value it returns early. Emissions can be
deferred with `requestIdleCallback`. Caret restoration must not touch the editor
before the baseline is established. It must also run outside an active
`editor.update` that would defer the state swap, as the comments in that file
explain. Because readiness may never arrive, waiting for it needs an explicit
stopping condition (section 7.3).

**Selection-only updates.** `OnChangePlugin` in `editor.tsx` uses
`ignoreSelectionChange` and drops updates tagged only with `focus`. A restored
selection must be a selection-only update that never reaches the form's
`onChange`.

**No auto-focus.** Rich-text editors must not be focused when they mount.
Restoration focuses only the resolved target.

**Nested editors.** Inline image captions and admonition bodies are nested Lexical
editors. Stage 3 restores selections only in a field's root editor.

**Drag handles.** Moving focus to an item's grip after a reorder must work with
dnd-kit's keyboard sensor, so that a keyboard reorder can continue after the save.

## 7. Stages and acceptance

Each stage can ship on its own. The browser checks are manual against a running dev
server, recorded as scenario plus observed result, because Byline has no automated
browser suite.

### 7.1 Stage 1 — visit store, tabs and collapse (closes #97)

- The store, its context and its lifetime rules (section 5.2), for collection edit
  views and singleton views.
- Tab selection is read from the store and written to it. `savedTabsRef` is
  retired, and the now-inaccurate comment on `useFormTabs`
  (`packages/admin/src/forms/use-form-tabs.ts`), which claims the lifted selection
  survives a locale switch, is corrected.
- Item collapse is read from the store and written to it, with positional
  addresses handled as section 5.3 describes.

Acceptance:

- In a host-level test that exercises the real route remount, a selected tab and
  two collapsed items survive a locale switch and a successful save. The existing
  `save-navigation.test.tsx` shows a viable harness.
- Opening another document, or leaving and reopening the same document, starts with
  defaults.
- A nested relation-picker create form does not share or alter the parent's state.
- A collapse record under a positional segment is not applied after the items
  before it are reordered.
- Browser: the #97 reproduction keeps the `Content` tab. Collapse two blocks,
  reorder a third, save: the blocks stay collapsed and the order is kept.

### 7.2 Stage 2 — working target and viewport (closes #98)

- Stable target markers, recording of the working target and its offset
  (section 5.4), restoration tied to the Save outcome (section 5.5), resolution
  and fallbacks (section 5.6), and focus and scroll for other navigations
  (section 5.7).

Acceptance:

- Test: edit a field, click Save, and the field has focus after the remount. The
  click path is covered explicitly, not only the Enter-in-field path.
- Test: change only the path, confirm the system-fields dialog, and the path
  control has focus after the save, with the same version ID and no remount.
- Test: edit field A, focus at least two other controls without changing them,
  then save. Field A has focus and is visible.
- Test: reorder an item after editing, then save, and the moved item's grip has
  focus.
- Test: when the target was removed, sits in a collapsed item or sits under an
  unselected tab, focus follows the section 5.6 fallbacks and is never on `<body>`.
- Test: a returned `committed-hook-failed` result, using the real server result
  shape, restores like a successful save.
- Test: a thrown committed-hook error keeps tabs and collapse and focuses the
  inline warning, which is visible.
- Test: after a locale switch, the locale selector has focus. After a status
  change, the status control has focus and the page has not scrolled to the top.
- Test: make the form dirty, switch locale, choose Stay. The working target, dirty
  state and visit are unchanged.
- Browser, the headline demonstration: collapse two blocks, reorder a third, edit a
  text field inside it, click Save. The field has focus, sits within roughly the
  same screen position, and you can keep typing. Repeat using only the keyboard,
  tabbing through at least two controls to Save and pressing Enter.
- `hasChanges` is false after every restoration.

### 7.3 Stage 3 — exact rich-text selection

- Record the selection structurally for the root editor of a rich-text field that
  is the working target: anchor and focus as a child-index path from the root plus
  a text offset. Lexical node keys cannot be used because they change on reload.
- Restoration first focuses the field as stage 2 does, so focus is never on
  `<body>` while it waits. It then places the caret only when all of these hold:
  - the editor's baseline is established for the reloaded value
  - the value was neither refused, null nor adapted
  - the normalized content is identical to what was saved
  - the selection is in the root editor and its path resolves

  Otherwise the stage 2 focus stands. The field's focusable wrapper is the
  fallback for a field. The block header is the fallback when the field sits in a
  block.
- Pending caret restoration is cancelled when you move on: focus moves elsewhere,
  you type, click or press a key, another navigation starts, or a bounded wait
  expires. The plan sets the bound. Restoration never takes focus back once it has
  been cancelled.

Acceptance:

- Test: place the caret midway through a paragraph, save, type one character. The
  form is clean immediately after restoration. The character lands at the saved
  position, and it counts as an edit.
- Test: when the server changes the field's content, or the content loads as
  adapted or refused, no caret is placed and the stage 2 focus stands.
- Test: if focus moves to another control before the baseline is ready, the caret
  is not restored and focus is not taken back.
- Browser: the same scenario in a long field, in a field inside a block, and with
  the caret inside a nested caption editor, which must fall back.

## 8. Left to the plan and the builder

- How the store's owner survives these navigations, once the router behaviour is
  verified (section 5.2).
- The exact target marker attribute, how widgets publish their address and role,
  and the focusable field wrapper used as a fallback.
- How edits and structural actions are detected, for example `input` and `change`
  events plus explicit calls from structural handlers (move, add, remove, toggle),
  provided the section 5.4 table holds.
- How restoration waits for the saved version's fields to render, and the bound on
  the rich-text wait.
- Whether the remembered state uses a subscription store
  (`useSyncExternalStore`) or refs, provided it does not re-render the form.
- Discovering call sites with `rg` and `pnpm typecheck` rather than relying on line
  numbers here.

## 9. Open questions

None.

## Revision log

- **2026-11-21, revision 1.** Drafted.
- **2026-11-22, revision 2.** After review:
  - Restoration is tied to the Save action and its outcome, so path-only saves that
    keep the version ID are covered.
  - Focus alone no longer records the working target, and the viewport offset is
    recorded at the action, so the keyboard trip to Save works.
  - Discard after a conflict ends the visit.
  - Positional address segments are never trusted for restoration.
  - Rich-text restoration has an explicit stopping condition and cancellation.
  - Corrected the claim that tabs reset on save.
  - The inline warning for a returned committed-hook result is out of scope and
    tracked in #113.
  - Corrected the refused-save outcome: a conflict blocks further saves through
    `mutationsBlocked`, while validation and ordinary request failures allow a
    retry.
