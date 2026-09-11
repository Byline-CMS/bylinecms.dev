---
title: "Editor toolbar hydration mismatch — reproduction"
path: "toolbar-hydration-mismatch"
summary: "Record a pre-existing server/client hydration mismatch in the richtext toolbar's keyboard-shortcut labels, found while reviewing unrelated work."
---

# Editor toolbar hydration mismatch — reproduction

Companions:

- [Richtext node ownership specification](./2026-09-11-richtext-node-ownership-spec.md) — the work during which this was found. It is unrelated to that work and predates it.

Date: 2026-09-11. Status: recorded, not scheduled. Not a regression.

## What happens

React reports a hydration mismatch on any server-rendered richtext toolbar:

```
A tree hydrated but some attributes of the server rendered HTML didn't match
the client properties. This won't be patched up.

+ title="Undo (⌘Z)"
- title="Undo (Ctrl+Z)"
+ aria-label="Format text as bold. Shortcut: ⌘B"
- aria-label="Format text as bold. Shortcut: Ctrl+B"
```

It affects `title` and `aria-label` on the undo, redo, bold, italic and underline buttons.

## Why

`packages/richtext-lexical/src/field/shared/environment.ts` computes the platform at module scope:

```ts
export const IS_APPLE: boolean = CAN_USE_DOM && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
```

`CAN_USE_DOM` is false on the server, so the server always renders the Windows label and a macOS client renders the Apple one. The toolbar reads `IS_APPLE` directly at `plugins/toolbar-plugin/index.tsx` (the undo, redo and inline-format buttons).

## Reproduction

1. Run the development server on macOS.
2. Open any server-rendered richtext field. `/admin/richtext-notices` is the quickest, since it renders two editors and needs no document.
3. Read the browser console.

## Why it is not a regression

The line is present at `aa97b0b9`, the commit before the node-ownership work began. The file carries Meta's copyright header and is inherited Lexical-playground code.

## Impact

React states plainly that it "won't be patched up", so the affected attributes keep the server's values until something re-renders that button. A macOS user can therefore see `Ctrl+B` in a tooltip, and the `aria-label` announces the wrong shortcut, which makes this accessibility-adjacent rather than purely cosmetic. No data or editing behaviour is affected.

## Suggested fix

Resolve the platform after mount so the first client render matches the server, then swap in the platform label — a `useSyncExternalStore` with a constant server snapshot, or a mounted flag. Whichever is chosen, the label must be derived per render rather than from a module-scope constant.
