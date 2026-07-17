# `@byline/richtext-lexical` extensions

Every built-in feature of the Lexical adapter — and every supported way for a third party to extend it — lives in this directory as a Lexical `defineExtension(...)` co-located with its node class(es), modal, decorator, and (where relevant) populate visitor.

This README is a navigation aid only. The full reference and authoring contract lives in the project's [`docs/04-collections/07-rich-text.md`](../../../../../docs/04-collections/07-rich-text.md) — start with the **Extensibility** section.

## What's where

| Directory | What it owns |
|---|---|
| `byline-toolbar/` | `BylineToolbarExtension` — the registry that built-in and third-party extensions contribute toolbar items into via `peerDependencies`. |
| `byline-floating-ui/` | `BylineFloatingUIExtension` — the registry every floating UI (link editor, table action menu, format pop-over, third-party) plugs into via `peerDependencies`. |
| `floating-text-format/` | Standalone extension that contributes the selection-format pop-over to `BylineFloatingUIExtension`. |
| `link/` | `LinkExtension`, `AutoLinkExtension`, link node + paste handling + `FloatingLinkEditorPlugin` (contributed back via peer dep), and the link populate visitor. |
| `table/` | `TableExtension` (Byline wrapper over `@lexical/table`), the table modal, and the `TableActionMenuPlugin` (contributed to the floating-UI registry). |
| `inline-image/` | `InlineImageExtension`, node + decorator + modal, picker-time embed, and the populate visitor for `{ title, altText, image, sizes }`. |
| `layout/` | `LayoutExtension`, columns layout node + modal. |
| `admonition/` | `AdmonitionExtension`, admonition node + modal. |
| `auto-embed/` | `AutoEmbedExtension` — paste-to-embed UX shared by the YouTube/Vimeo embedders. |
| `youtube/`, `vimeo/` | Embed extensions and their node decorators. |
| `code-highlight/` | Syntax-highlight extension over `@lexical/code`. |
| `horizontal-rule/` | Byline wrapper over the upstream `@lexical/react/LexicalHorizontalRuleNode`. |

## Adding a new extension

1. Create a directory next to these.
2. Implement your `defineExtension(...)` (and any nodes / decorators).
3. To contribute a toolbar item or a floating UI, declare a peer dependency against `BylineToolbarExtension` / `BylineFloatingUIExtension` — see the worked recipes in `docs/04-collections/07-rich-text.md`.
4. Either register your extension at site level via `lexicalEditor((c) => c.extensions.add(MyExtension))`, or — if it's a built-in being shipped by this package — append it to `defaultExtensionsArray()` in `field/config/default-extensions.ts`.

You should never need to touch `field/editor.tsx` to add a feature.
