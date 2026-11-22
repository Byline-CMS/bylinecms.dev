---
"@byline/admin": minor
"@byline/host-tanstack-start": minor
"@byline/richtext-lexical": minor
---

**The document editor now keeps its layout across saves and content-locale switches** (#97, #98). For the length of one editing visit, the selected tab in each tab set and the collapsed array and block items (by item identity) survive a locale switch, and collapsed items also survive a save and a status change. After a successful save, focus returns to the field or control you were working in and the scroll position is restored. The caret returns in plain inputs, textareas and the rich-text root editor when the saved content is unchanged. After a locale switch, focus goes to the locale selector. A refused save skips the successful-save restoration. Opening another document, returning from the list, or reloading starts a new visit, and nothing is persisted or sent to the server. Restoring never marks the form dirty, and a restoration is discarded if you move on first.

`@byline/admin/react` adds `useEditorViewVisit`, `useEditorViewState`, `claimSaveAttempt`, `beginActionRestore`, `noteActionLaunch`, `documentActionMarker`, `useRichTextSelectionMemory` and the editor view-state types. `SortableItem` and `StaticItem` take an optional `itemPath`. Custom `components.Field` slots for text, textArea and numerical fields record edits through `onChange`, and restoration focuses the slot element that carries the `id` prop the slot receives. Hosts other than TanStack Start own a visit with `useEditorViewVisit`; see the Editor view state document.
