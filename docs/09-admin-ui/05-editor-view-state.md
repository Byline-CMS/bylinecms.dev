---
title: "Editor view state"
path: "editor-view-state"
summary: "How the document editor remembers tabs, collapsed items, focus, scroll position and caret for one editing visit, what starts a new visit, and what a host or custom field must do to take part."
---

# Editor view state

Companions:
- [Admin UI](./index.md) — the building blocks of Byline's admin interface and how a host application wires them in.
- [Richtext field capabilities](./04-richtext-capabilities.md) — the Lexical field whose caret the editor can restore after a save.
- [Admin-config registration](./02-admin-config-registration.md) — how the admin configuration reaches the browser, and how custom field components are supplied.
- [Singletons](../04-collections/09-singletons.md) — the one-document resources whose edit view behaves the same way.

When you save a document or switch its content locale, the admin refreshes the form from the server. Without help, that refresh would expand every collapsed block, scroll to the top and leave keyboard focus on the page body, and a locale switch would also return every tab set to its first tab. Read this document when you want to know what the editor now keeps across those refreshes, when it deliberately forgets, and what a host application or custom field component must do to take part.

## Overview

Two terms describe the behaviour.

An **editing visit** is the period from opening one document in the edit view until you leave it. Saving, changing workflow status, scheduling and switching the content locale all stay inside one visit. Opening a different document, going to the list, history or API view and coming back, and reloading the page each start a new visit.

The **working target** is the control where you last did editing work. It is either the last field you edited or the control for your last structural action: moving, collapsing, adding or removing an array or block item. Byline records the target together with its distance from the top of the viewport, so it can put the target back at about the same place on screen.

The admin keeps this state in a small in-memory store for the length of a visit. The store holds no field values and creates no patches. Restoring state never marks the form as changed, and nothing is sent to the server. Nothing is written to `localStorage`, `sessionStorage` or the URL, so a reload always gives you a clean editor.

## What the editor remembers

During a visit the store records:

- The selected tab in each tab set.
- Which array and block items are collapsed. Items are identified by their stable item identity, not by position, so reordering an item does not move its collapsed state to a neighbour.
- The working target and its viewport offset.
- The caret or selection, in plain text inputs and textareas and in the root editor of a rich-text field.

Create forms and nested forms, such as the create form inside the relation picker, receive no store. They keep their previous behaviour.

## What happens after a save

After a successful save, the editor does the following:

1. Keeps every tab selection and collapsed item.
2. Returns focus to the working target and restores the scroll position. When the reloaded layout allows it, a field that was partly visible keeps its exact position on screen. This is best effort, and a layout that has become shorter can limit it.
3. Returns the caret only when the saved content is unchanged. For a plain input or textarea, unchanged means the value matches the one the save started from. For rich text, it means the normalised content matches, ignoring only metadata the server refreshed for the same embedded document. A different link destination, embed, formatting, caption or unknown attribute counts as a change. When the content differs, focus lands on the field and no caret is placed.
4. Never restores a caret inside a nested editor such as an image caption. Editing a caption leaves focus on the field.
5. Never falls back to a neighbouring item. If the exact target is gone, the editor uses the nearest ancestor that has a stable identity, or the containing field.

A refused save, such as a validation failure or a concurrency conflict, skips this successful-save restoration. The form's existing validation and conflict focus behaviour still runs. When a save commits but an after-hook then throws an error that the editor shows as an inline warning, focus goes to that warning. A committed-hook result that is returned and shown only as a toast restores normally.

## Locale switches and other actions

After you switch the content locale, tabs and collapsed items carry across for every item that exists in the new language. Focus goes to the locale selector. The previous language's working target and caret are cleared, because they refer to text that is no longer on screen.

A status change, schedule or similar action focuses the control that launched it when that control survives the refresh, and otherwise falls back to a nearby action control or the locale selector. The scroll position is not reset.

## Moving on wins

A restoration never fights you. If you focus another control, type, or click anywhere before a pending restoration runs, the restoration is discarded. A rich-text caret also waits for a short window for its editor to be ready. If you have not moved on and the editor is still not ready when the window ends, the field's focus stands and no caret is placed.

## Integrating a host

The TanStack Start host in `@byline/host-tanstack-start` already does everything described here. A host that supplies its own edit route must do the following, in this order. All names come from `@byline/admin/react`.

1. **Own the visit.** Call `useEditorViewVisit(identity)` in a component that survives the edit view's remounts. The TanStack host uses its route component; another host can use any component with that property. Use `collection/<path>/<id>` for a collection document and `singleton/<path>` for a singleton. The locale is not part of the identity, and a new identity creates a new store.
2. **Pass the store and state to the form.** Give `FormRenderer` the store as `viewState`, the refreshed document, including its `revision`, as `initialData`, and the content locale actually shown as `effectiveContentLocale`. Restoration waits until the form has rendered the revision a save or action expects.
3. **Report each save.** Call `claimSaveAttempt(store)` synchronously at the top of your `onSubmit` handler, before the first `await`. When the server accepts the save, call `attempt.expectRefresh({ revision })` next to the place where you adopt the receipt. If a thrown committed-hook error is shown as an inline warning, call `attempt.markSaveWarning()` and, when the error carries receipt details, `expectRefresh` with them. Attempts that a newer save has superseded are ignored.
4. **Report each other action.** For a status change, locale switch or similar navigation, call `noteActionLaunch(store, control)` first when a popup trigger launched the action. Then call `beginActionRestore(store, { role, fromLocale, ... })` synchronously, before any `await`, and keep the returned claim. Calling it alone records nothing. Just before the successful navigation, call `claim.record({ toLocale, expectedRevision })` with the values that apply. Mark the launching control with `documentActionMarker('action:<name>')`.
5. **Preserve scroll during the refresh.** Navigate or reload without resetting scroll. The TanStack host passes `resetScroll: false` to `navigate`; other routers need the equivalent option.

`useEditorViewState()` reads the store from React context inside the form and returns `null` when there is none, so consumers must tolerate that. The package also exports the `EditorViewStateStore` type and related types. A host that supplies no store keeps the previous behaviour, with no restoration and no errors.

## Custom fields

Built-in fields take part automatically. A custom component supplied through the `components.Field` slot for a text, textArea or numerical field records edits through the `onChange` callback it receives, so call that callback whenever the value changes. A custom widget that has no native input event and never calls a slot callback is not recorded, so the editor cannot return to it.

`SortableItem` and `StaticItem` accept an optional `itemPath` prop, the item's instance path. Pass it when you render your own array or block items so their collapsed state is remembered by identity. Without it, the item is not remembered. Rich-text fields built on `@byline/richtext-lexical` use `useRichTextSelectionMemory` from `@byline/admin/react` to record and replay the root editor's selection.

## Limits

- Firefox and Safari have not been verified for this behaviour. Verification was done in Chromium.
- A check against a deployed, higher-latency environment is outstanding. Local timing is not a guarantee for slow networks.
- After a reload that produces a shorter layout, the editor checks that the field control is visible. It does not check the rich-text caret, which is placed slightly later, so the caret is not guaranteed to be on screen.
- Scroll positions inside nested scroll containers, open dropdowns, open modals and picker state are not remembered.
- Lexical undo history is still lost when a save remounts the form.
- View state does not survive a full reload or the round trip through full-page preview.

## Implementation references

- `packages/admin/src/forms/view-state/` holds the store, restoration logic, target markers and the visit hook.
- `packages/admin/src/forms/view-state/restore-session.ts` implements `claimSaveAttempt`, `beginActionRestore` and `noteActionLaunch`.
- `packages/admin/src/fields/sortable-item.tsx` implements collapsed-item memory.
- `packages/richtext-lexical/src/field/selection-restore-plugin.tsx` and `content-fingerprint.ts` implement rich-text caret replay and the unchanged-content rule.
- `packages/host-tanstack-start/src/routes/create-collection-edit-route.tsx` and `create-singleton-route.tsx` own the visit, and `admin-shell/collections/edit.tsx` reports save attempts and actions.
- The design decisions are recorded in `specs/2026-11-21-editor-view-state-spec.md`.

## Tests

Node-mode unit tests sit beside the view-state modules (`*.test.node.ts`). Component tests include `form-renderer-view-state.test.tsx`, `form-renderer-restore.test.tsx` and `use-editor-view-visit.test.tsx` in `packages/admin`, `selection-restore.test.tsx` in `packages/richtext-lexical`, and `save-navigation.test.tsx` in `packages/host-tanstack-start`. There is no automated browser suite, so scroll and focus behaviour was verified by hand against a running dev server.
