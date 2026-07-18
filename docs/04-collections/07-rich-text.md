---
title: "Rich Text Editor"
path: "richtext"
summary: "Byline's Lexical-based rich text editor: the extension API, built-in nodes (links, inline images, admonitions, layout, code, tables), and the runtime serializer pipeline."
---

# Rich Text Editor

Companions:
- [Core Composition](../03-architecture/02-core-composition.md) — the broader roadmap for how Byline composes adapter packages (db, storage, session, editors).
- [Relationships](./03-relationships.md) — the relation-field primitive that richtext links and inline images are layered on top of.

## Overview

Byline's richtext is pluggable through a deliberately small adapter contract. Today the project ships one editor — `@byline/richtext-lexical` — built on Lexical. The cross-editor contract (a client render component and a server populate function) stays minimal so a future TipTap or markdown adapter can fit the same shape. On top of that, the Lexical adapter exposes a **BYO-extension surface** built on Lexical's [Extensions API](https://lexical.dev/docs/extensions/intro) — site authors and third parties register Lexical extensions through a chainable list and contribute toolbar / floating-UI items through typed peer dependencies on `BylineToolbarExtension` and `BylineFloatingUIExtension`.

`@byline/ui` no longer depends on Lexical at all. `@byline/richtext-lexical` ships two entry points — the default export is the React render surface; `@byline/richtext-lexical/server` carries two factories (`lexicalEditorEmbedServer` and `lexicalEditorPopulateServer`) that wire the same visitor pipeline into the framework's write and read paths respectively.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end of each entry points at the deeper architecture section.

### 1. Register the editor

Default registration — every `richText` field gets the full feature set.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { RichTextField } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: { editor: RichTextField },
  },
})
```

→ [The adapter surface](#the-adapter-surface)

### 2. Configure editor settings (site-wide)

Override placeholder / markdown shortcuts / debug — settings only, no extension changes.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.settings.placeholderText = 'Start writing…'
        c.settings.options.markdownShortcutPlugin = true // inline `# `, `**bold**`, … shortcuts
        c.settings.options.markdownToggle = true // document-level "view as markdown source" toolbar button
        return c
      }),
    },
  },
})
```

→ [Editor settings and extensions](#editor-settings-and-extensions)

### 3. Remove a built-in extension

Drop features the installation doesn't want. Toolbar items and floating UIs that belong to a removed extension disappear automatically.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { lexicalEditor, TableExtension, AdmonitionExtension } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.extensions.remove(TableExtension).remove(AdmonitionExtension)
        return c
      }),
    },
  },
})
```

→ [Editor settings and extensions](#editor-settings-and-extensions)

### 4. Configure a built-in extension

Pass config through to a wrapped extension — `TableExtension` here delegates to `@lexical/table` and accepts its `hasCellMerge` / `hasCellBackgroundColor` knobs.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { lexicalEditor } from '@byline/richtext-lexical'
import { TableExtension as LexicalTableExtension } from '@lexical/table'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.extensions.configure(LexicalTableExtension, {
          hasCellMerge: false,
          hasCellBackgroundColor: false,
        })
        return c
      }),
    },
  },
})
```

→ [Editor settings and extensions](#editor-settings-and-extensions)

### 5. Add a third-party extension

Site-wide enable for an external Lexical extension.

**Edit:** `apps/webapp/byline/admin.config.ts`

```ts
import { lexicalEditor } from '@byline/richtext-lexical'
import { MyCustomExtension } from '@my-org/lexical-myfeature'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => c.extensions.add(MyCustomExtension)),
    },
  },
})
```

→ [Editor settings and extensions](#editor-settings-and-extensions)

### 6. Contribute a toolbar item

Extension authors declare a peer dependency on `BylineToolbarExtension` and supply an `items` array. Built-ins and third parties use the same contract.

**Edit:** the extension author's own package — for the Byline AI plugin this is `packages/ai/src/plugins/lexical/extension.tsx`.

```tsx
import {
  BylineToolbarExtension,
  type BylineToolbarConfig,
  useToolbarActiveEditor,
} from '@byline/richtext-lexical'
import { declarePeerDependency, defineExtension } from 'lexical'

function MyInsertItem() {
  const editor = useToolbarActiveEditor()
  return <button onClick={() => editor.dispatchCommand(INSERT_MY_THING_COMMAND, null)}>Insert</button>
}

export const MyExtension = defineExtension({
  name: '@my-org/lexical-myfeature/MyExtension',
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@my-org/lexical-myfeature/MyExtension/insert',
          placement: 'insert-menu',  // or 'toolbar' for the main row
          order: 100,
          node: <MyInsertItem />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
  ],
})
```

→ [The toolbar registry](#the-toolbar-registry)

### 7. Contribute a floating UI

Same shape as toolbar contributions, but the peer target is `BylineFloatingUIExtension`. Your component receives `anchorElem: HTMLElement` and is expected to portal into it.

**Edit:** the extension author's own package.

```tsx
import {
  BylineFloatingUIExtension,
  type BylineFloatingUIConfig,
  type BylineFloatingUIProps,
} from '@byline/richtext-lexical'
import { declarePeerDependency, defineExtension } from 'lexical'

function MyPopover({ anchorElem }: BylineFloatingUIProps) {
  // …createPortal into anchorElem, position against the selection, etc.
}

export const MyFloatingExtension = defineExtension({
  name: '@my-org/lexical-mypopover',
  peerDependencies: [
    declarePeerDependency<typeof BylineFloatingUIExtension>(BylineFloatingUIExtension.name, {
      items: [{ id: '@my-org/lexical-mypopover/popover', Component: MyPopover }],
    } satisfies Partial<BylineFloatingUIConfig>),
  ],
})
```

→ [The floating-UI registry](#the-floating-ui-registry)

### 8. Per-field editor override (wrapper component)

Schema-side `editorConfig` can only carry **settings** (JSON-safe). For per-field **extension** differences, register a wrapper editor component via `FieldAdminConfig.editor`.

**Edit:** `apps/webapp/byline/fields/<your-wrapper>.tsx` (component) + `apps/webapp/byline/collections/<name>/admin.tsx` (attachment).

```tsx
// apps/webapp/byline/fields/richtext/lexical-richtext-ai.tsx
import { lexicalEditor } from '@byline/richtext-lexical'
import { AiLexicalExtension } from '@byline/ai/plugins/lexical'

export const LexicalRichTextAi = lexicalEditor((c) => {
  c.extensions.add(AiLexicalExtension)
  return c
})

export function aiRichTextAdmin(): FieldAdminConfig {
  return { editor: LexicalRichTextAi }
}
```

```ts
// apps/webapp/byline/collections/news/admin.tsx
fields: {
  content: aiRichTextAdmin(),
}
```

→ [The adapter surface](#the-adapter-surface)

### 9. Per-field settings preset

For per-field **settings** (not extensions) the schema can carry an `editorConfig`. Helpers like `lexicalRichTextCompact` bake a settings preset into a `RichTextField` factory.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts` (use) and `apps/webapp/byline/fields/richtext/lexical-richtext-compact.ts` (the helper itself).

```ts
import { lexicalRichTextCompact } from '../../fields/lexical-richtext-compact.js'

fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),

  // Compact + per-field placeholder:
  lexicalRichTextCompact({
    name: 'summary',
    configure: (c) => {
      c.settings.placeholderText = 'One-sentence summary…'
      return c
    },
  }),
]
```

The factory imports `defaultEditorConfig` from `@byline/richtext-lexical/server` (data-only, no React) so schema files using it stay tsx-loadable for seeds.

→ [Editor settings and extensions](#editor-settings-and-extensions)

### 10. Embed-on-save / populate-on-read field flags

Per-field policy for relation-bearing nodes (internal links, inline images). Defaults to **snapshot** (`embedRelationsOnSave: true`) — every save runs the server-side embed walker to refresh embedded `{ title, path, … }` envelopes before persistence.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
fields: [
  { name: 'body', type: 'richText' },                                 // snapshot (default) — embed walker on save
  { name: 'caption', type: 'richText',
    embedRelationsOnSave: false },                                    // storage-thin — populate on every read
  { name: 'callout', type: 'richText',
    embedRelationsOnSave: true, populateRelationsOnRead: true },      // belt-and-braces — walker on save AND read
]
```

→ [Relations — embed and populate](#relations-embed-and-populate)

### 11. Register the richtext server adapters

Two opt-in lines at boot, both produced from the same Lexical visitor pipeline. `lexicalEditorEmbedServer()` runs on every richtext write to refresh embedded envelopes ahead of persistence. `lexicalEditorPopulateServer()` runs on every read whose field opted into populate. Target documents are supplied through core's secure reader, which enforces the target collection ability, strict `beforeRead` scope, effective read mode, and `afterRead` redaction. Strict target filters compile separately from caller filters and once per logical `ReadContext` + target collection + mode in private, authority-bound state. `initBylineCore()` fail-fasts at boot when either adapter is missing for a field that requires it.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import {
  lexicalEditorEmbedServer,
  lexicalEditorPopulateServer,
} from '@byline/richtext-lexical/server'
import { getAdminBylineClient } from '@byline/client/server'

await initBylineCore({
  // …db, collections, storage, sessionProvider, adminStore, …
  fields: {
    richText: {
      embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
      populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
    },
  },
})
```

→ [Server-side embed and populate](#server-side-embed-and-populate)

### 12. Per-collection link path composition

Define how a document's persisted slug composes into a renderable root-relative path. Read by the server-side richtext embed walker (to canonicalise `document.path` on internal links) and by `CollectionAdminConfig.preview.url`. Optional — when omitted, the embed walker falls back to `/${collectionPath}/${slug}`.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const Pages = defineCollection({
  path: 'pages',
  useAsTitle: 'title',
  useAsPath: 'title',
  // Locale-agnostic root-relative path. No locale prefix — the renderer
  // composes that at request time. Return `null` to signal "no path".
  buildDocumentPath: (doc) => {
    if (!doc.path) return null
    const area = doc.fields?.area
    if (typeof area === 'string' && area !== 'root') {
      return `/${area}/${doc.path}`
    }
    return `/${doc.path}`
  },
  // …
})
```

→ [Server-side embed and populate](#server-side-embed-and-populate)

---

## Architecture

### The adapter surface

Six things compose the present surface:

1. **The render-component contract** — `RichTextEditorComponent` in `@byline/core`.
2. **The client-side slot** — `ClientConfig.fields.richText.editor`. Registered once in `apps/webapp/byline/admin.config.ts`.
3. **The server-side embed contract** — `RichTextEmbedFn` in `@byline/core`. Framework-agnostic. Runs on every richtext write to refresh embedded relation envelopes ahead of persistence.
4. **The server-side populate contract** — `RichTextPopulateFn` in `@byline/core`. Mirror of the embed contract; runs on the read path for fields that opted into populate. Both receive the authenticated operation context, effective read mode, and a framework-owned `readDocuments` function; adapters must use that reader for targets instead of accessing storage directly.
5. **The server-side slots** — `ServerConfig.fields.richText.{ embed, populate }`. Registered once in `apps/webapp/byline/server.config.ts`. The bootstrap validator fail-fasts when either is missing for a field that requires it.
6. **An opaque per-field config slot** — `RichTextField.editorConfig?: unknown`. Each editor adapter owns its own config shape; `@byline/core` does not interpret it.

```ts
// packages/core/src/@types/field-types.ts
export interface RichTextEditorProps {
  field: RichTextField
  defaultValue?: unknown
  onChange: (value: unknown) => void
  path: string
  instanceKey: string
  locale?: string
}
export type RichTextEditorComponent = SlotComponent<RichTextEditorProps>
```

```ts
// packages/core/src/@types/site-config.ts (excerpt)
export interface ClientConfig extends BaseConfig {
  admin?: CollectionAdminConfig[]
  fields?: {
    richText?: { editor: RichTextEditorComponent }
  }
}

export interface ServerConfig<TAdminStore = unknown> {
  // …
  fields?: {
    richText?: {
      embed?: RichTextEmbedFn       // write-time walker
      populate?: RichTextPopulateFn // read-time walker
    }
  }
}
```

`@byline/richtext-lexical` exports both `RichTextField` (component matching `RichTextEditorComponent` directly) and `lexicalEditor()` (a registration factory that bakes settings + extensions in via a closure). Either form satisfies the slot. Alternative editor packages (`@byline/richtext-tiptap`, `@byline/richtext-md`, …) only need a component matching `RichTextEditorComponent`.

**Renderer dispatch.** `packages/admin/src/fields/field-renderer.tsx` reads the configured editor at render time and throws if none is registered. The throw is the failure mode by design — a `richText` field with no editor is unusable, and loud first-render feedback beats a silent textarea fallback.

**Per-field override precedence.** `FieldComponentSlots.Field` overrides win over the site-wide default. `FieldAdminConfig.editor` (recipe 8) is the typed convenience for "this field needs a different editor entirely."

**Why `editorConfig` stays opaque.** Lexical, TipTap, and ProseMirror don't share a feature graph. Each editor adapter owns its own config shape and its own cast at its own boundary. A shared feature-graph contract is not part of today's design; see [Current limitations](#current-limitations).

### Editor settings and extensions

The Lexical adapter's configuration has two parts:

- **`settings`** — JSON-safe (booleans, strings, the inline-image upload collection). Allowed to ride along in a schema's `editorConfig`, survives tsx-loaded seeds.
- **`extensions`** — a chainable `ExtensionsList` of Lexical extensions wired into the editor's dependency graph. Carries function references and React decorators; *not* JSON-safe. Only meaningful at registration time or inside a client-only wrapper component, never persisted into a schema.

The wrapper in `@byline/richtext-lexical` resolves the full config at render time in priority order:

1. **`field.editorConfig`** — most specific. The schema author opted in for this field. Settings only.
2. **`editorConfig` baked in via `lexicalEditor(configure)`** — site-wide. May customise both `settings` and `extensions`.
3. **`defaultEditorConfig` + `defaultExtensionsList()`** — package fallbacks.

**The chainable extensions API.** Inside `lexicalEditor((c) => ...)` the seed always carries an `ExtensionsList` populated with every Byline built-in. Mutations to `c.extensions` are local to that one call.

```ts
c.extensions.add(extension)                       // push to the end
c.extensions.remove(extension)                    // remove by name (no-op if absent)
c.extensions.replace(oldExtension, newExtension)  // preserve position
c.extensions.configure(extension, config)         // re-wrap with configExtension(extension, config)
c.extensions.has(extension)                       // boolean test by name
```

Comparison is by extension `name` (Lexical's own dedup key), so a bare `LinkExtension` and `configExtension(LinkExtension, {...})` are treated as the same entry. Adding two extensions with the same name throws at composer-build time — replace built-ins via `remove(...)` + `add(yours)`, not by name collision.

### Markdown source toggle and transformers

A document-level "view as markdown source" toggle, opt-in per installation via the `markdownToggle` editor setting (default `false`; recipe 2 enables it). When on, a capital-**M** button sits at the right of the toolbar; clicking it flips the editing surface between the WYSIWYG editor and a single markdown `CodeNode` holding the document's raw markdown — and back.

- **Patch-aware.** The editor is bound to a Byline form field that accumulates `DocumentPatch[]`. While in source mode, keystrokes are suppressed from the form's `OnChangePlugin` via a synchronous `markdownModeRef` guard, so the transient source view never leaks into the patch stream. A no-edit round-trip (WYSIWYG → markdown → WYSIWYG with no changes) restores the *exact* captured `EditorState`, so the form records **no patch**; edits made in source emit a single field change on toggle-back (**one patch**). Mode state lives in `MarkdownModeProvider` (`field/context/markdown-mode-context.tsx`); the conversion + root-shape guard live in the `useMarkdownToggle` hook (`field/hooks/use-markdown-toggle.ts`).
- **Transformers.** Conversion runs through `BYLINE_TRANSFORMERS` (`field/markdown/transformers.ts`) — the stock `@lexical/markdown` `TRANSFORMERS` extended with custom handlers: GFM pipe **tables** (adapted from the Lexical playground) and Docusaurus-style `:::type[Title] … :::` **admonitions** (`note` / `tip` / `warning` / `danger`). Admonition bodies use an inline-only transformer set because the node's nested editor (a bare `createEditor()`) holds only paragraphs + inline formatting. The same `BYLINE_TRANSFORMERS` array is wired into the inline `MarkdownShortcutPlugin` so typed shortcuts and the source view stay consistent.
- **Lossy nodes (known gap).** Custom nodes without a transformer — **layout** columns and **inline images** — are dropped/flattened on a markdown round-trip. A guard to disable the toggle (or warn) when an un-round-trippable node is present is planned alongside extending the transformer set.
- **Distinct from server-side export.** This toggle is the *bidirectional, lossless* browser path for a single richtext field. Serving a markdown representation of a whole published document at its route is a separate, one-way concern; see [Markdown Export](../05-reading-and-delivery/04-markdown-export.md).

### The toolbar registry

`BylineToolbarExtension` is a typed Lexical extension whose merged config is `{ items: BylineToolbarItem[] }`. Contributors declare it as a peer dependency and supply an `items` array; the toolbar plugin reads the merged list via `useExtensionDependency(BylineToolbarExtension)` and dispatches by placement.

```ts
export type BylineToolbarPlacement = 'toolbar' | 'insert-menu'

export interface BylineToolbarItem {
  id: string                       // stable identifier — React key + dedup
  placement: BylineToolbarPlacement
  order?: number                   // sort key within placement; lower first
  node: React.ReactNode
}
```

**Contract details:**

- `placement: 'toolbar'` appends to the main row, after the built-in format buttons. `placement: 'insert-menu'` adds to the "Insert" dropdown, which only renders when at least one insert-menu contribution is present.
- Built-ins use `order` 10/20/30/40/50/60 for horizontal-rule / layout / admonition / inline-image / table / embeds; pick something outside that range to avoid surprise re-orderings.
- `id` convention: `<extension-name>/<purpose>`.
- The contributed `node` renders inside `ToolbarActiveEditorProvider`, so `useToolbarActiveEditor()` returns the editor that owns the current selection (root editor, or a nested composer like an inline-image caption). For built-in insert items the toolbar suppresses the Insert dropdown when the active editor isn't the root.

**Suppression by removal.** When you `c.extensions.remove(LinkExtension)`, the link toolbar items disappear automatically — Lexical only delivers peer contributions from extensions that are actually in the graph. The block-format dropdown similarly hides Bullet/Numbered list, Check List, and Code Block entries when the relevant extension isn't present (`useOptionalExtensionDependency` gating).

### The floating-UI registry

Sibling of the toolbar registry: `BylineFloatingUIExtension` collects every floating UI mounted under the editor's shared anchor (`anchorElem` = the inner `.editor` div). `Editor.tsx` reads the merged list and renders every contributor — built-in and third-party alike.

```ts
export interface BylineFloatingUIProps {
  anchorElem: HTMLElement
}

export interface BylineFloatingUIItem {
  id: string                                              // React key + dedup
  Component: React.ComponentType<BylineFloatingUIProps>   // expected to portal into anchorElem
  order?: number                                          // sort key
}
```

**Contributors today:**

| Extension | Contributes | Notes |
|---|---|---|
| `LinkExtension` | `FloatingLinkEditorPlugin` | Edit / unlink popover above a link node. |
| `TableExtension` | `TableActionMenuPlugin` | Reads `hasCellMerge` from upstream `LexicalTableExtension`. |
| `FloatingTextFormatExtension` | `FloatingTextFormatToolbarPlugin` | Standalone — owns the selection format popover. |

**Suppression by removal.** Remove the contributing extension and the floating UI disappears with it. There are no per-floating-UI boolean toggles. To hide the selection format popover specifically, `c.extensions.remove(FloatingTextFormatExtension)`.

**Table cell-merge.** `TableActionMenuPlugin` reads `hasCellMerge` from the upstream `LexicalTableExtension.config` via `useExtensionDependency`. Override it with `c.extensions.configure(LexicalTableExtension, { hasCellMerge: false })` — the action menu UI follows automatically.

**The toolbar plugin** (the fixed row above the content-editable) is a *consumer* of `BylineToolbarExtension`, not a contributor. It needs a fixed DOM position the decorator slot can't express, so it lives in `Editor.tsx` directly. Moving it under the extension graph later is possible via an Output Component pattern; it is not currently a pain point.

### Relations — embed and populate

The link and inline-image nodes are the editor's two relation-bearing node types — the first non-form consumers of Byline's `DocumentRelation` envelope. They have a per-field policy for how target document data flows in and out.

**Two phases, paired per field, both server-side:**

| Phase | What it does | Field flag | Default |
|---|---|---|---|
| **Embed** | On every save, a write-time walker refreshes embedded `{ title, path, … }` envelopes against targets visible in the operation before the row is persisted. Marks links as `_resolved: false` when a target cannot be resolved. | `embedRelationsOnSave` | `true` |
| **Populate** | On every read, the framework refreshes embedded data by calling the registered server adapter. | `populateRelationsOnRead` | `!embedRelationsOnSave` |

The modal-time picker writes a tentative `{ title, path }` envelope so the in-editor display has a label immediately, but it is **not** the authoritative shape — the server walker rewrites it (or marks it unresolved) on save. Both save-time refresh and read-time population resolve targets in the originating actor's context. The framework asserts the target collection's `read` ability, applies its strict `beforeRead` predicate, runs `afterRead`, and preserves the inherited read mode; embed refreshes deliberately use the published view.

**Four meaningful states:**

| `embedRelationsOnSave` | `populateRelationsOnRead` (effective) | Behaviour |
|---|---|---|
| `true` (default) | `false` (default-derived) | **Snapshot.** Walker fires on save, rendered as embedded; reads return the persisted envelope verbatim. Cheapest reads; accept staleness between saves. |
| `false` | `true` (default-derived) | **Storage-thin.** Save skips the walker (relation primary keys only land on disk); populate runs on every read. Always fresh; highest read cost. |
| `true` (explicit) | `true` (explicit) | **Belt-and-braces.** Walker fires on save *and* on read. Snapshot is the fallback if populate is ever skipped. |
| `false` | `false` | **Invalid.** `initBylineCore()` throws — the field would be unrenderable. |

`initBylineCore()` fail-fasts on:
- Any field with effective `embedRelationsOnSave === true` and no `ServerConfig.fields.richText.embed` registered.
- Any field with effective `populateRelationsOnRead === true` and no `ServerConfig.fields.richText.populate` registered.

Loud at boot beats a silent broken renderer at request time.

**Internal link path composition — `buildDocumentPath`.** The link walker composes `document.path` through a per-collection hook on `CollectionDefinition`. The hook returns a **locale-agnostic root-relative path** (leading slash, no host, no locale prefix); the renderer composes the final URL at request time. When the hook is not defined, the walker falls back to the generic `/${collectionPath}/${slug}`.

```ts
// packages/core/src/@types/collection-types.ts
buildDocumentPath?: (
  doc: { id: string; path: string; status: string; fields: Record<string, any> },
  ctx: { collectionPath: string }
) => string | null
```

This is the single source of truth for how a document addresses publicly. `CollectionAdminConfig.preview.url` should delegate to it (see `apps/webapp/byline/collections/pages/admin.tsx` for the pattern). The walker calls `buildDocumentPath` inside a `try` — if it throws, the walker logs at `info` level and leaves the previous `document.path` untouched (branch A).

**Three save-time branches, per link node.**

| Branch | Trigger | Effect on `document` |
|---|---|---|
| **Found** | Target resolved; `buildDocumentPath` (or generic fallback) returned a string | `title` ← `target.fields[useAsTitle]`; `path` ← canonical leading-slash path; any prior `_resolved` flag cleared |
| **A — hook threw** | `buildDocumentPath` raised | Log at `info`; leave `document.path` and `_resolved` untouched. Renderer's fallback chain copes |
| **B — target unresolved** | Batch fetch did not return the target id (deleted, unpublished in the selected view, or hidden by row scope) | Log at `warn`; delete `title` / `path`; set `_resolved: false`. Persisted relation identity remains so the editor can re-link |

Branch C — DB unreachable or transport-level failures — bubbles up to `embedRichTextFields`, which catches per-leaf and logs at `error`. The persisted state for that leaf stays as the editor submitted it; the rest of the document continues.

**What the embed envelope carries:**

- **Internal link** — `{ title?, path?, _resolved?: false }`. `title` from the target's `useAsTitle` field; `path` either canonical-with-leading-slash (set by the walker) or a bare slug (picker-time only, healed on next save). `_resolved: false` means the target was not resolvable or visible in that operation.
- **Inline image** — `{ title, altText, image, sizes }`. `image` is the source media's `StoredFileValue`; `sizes` is `deriveImageSizes(image.variants)` flattened into a renderer-friendly `{ name, url, width, height, format }[]`. Top-level `src` / `width` / `height` / `altText` are also persisted on the inline-image node — Lexical needs them to render in the admin editor, and they remain a usable fallback when populate hasn't run.

**Persisted shapes.** Two slightly different on-disk layouts, same envelope:

```ts
// Link node — relation envelope nested under `attributes`.
export interface InternalLinkDocument {
  title?: string
  path?: string         // canonical (leading `/`) or bare slug
  _resolved?: false     // set by walker on target-missing branch
}
export type LinkAttributes =
  | { linkType: 'custom'; url?: string; newTab?: boolean; rel?: null | string }
  | {
      linkType: 'internal'
      newTab?: boolean
      rel?: null | string
      // DocumentRelation, flattened:
      targetDocumentId: string
      targetCollectionId: string
      targetCollectionPath: string
      document?: InternalLinkDocument
    }
```

```ts
// Inline-image node — relation envelope flattened directly onto the node.
// DocumentRelation is generic in its `document` payload; inline-image
// pins an image-specific shape, link pins InternalLinkDocument above.
export type SerializedInlineImageNode = Spread<
  DocumentRelation<{
    title?: string
    altText?: string
    image?: StoredFileValue
    sizes?: ReadonlyArray<{ name: string; url: string; width: number; height: number; format: string }>
  }> & {
    src: string
    altText: string
    position?: Position
    width?: number | string
    height?: number | string
    showCaption: boolean
    caption: SerializedEditor
  },
  SerializedLexicalNode
>
```

The two layouts differ for historical / Lexical-mechanics reasons (the link node extends `ElementNode` and wraps its custom attrs in `attributes`; the inline-image node spreads them flat). Both carry the same `DocumentRelation` envelope — the visitor abstraction in `lexical-populate-shared.ts` papers over the difference. The `document` payload is **advisory** in either layout — renderers must tolerate it being absent.

**Renderer fallback chain (internal links).** The host-side serializer reads `document.path` with a four-step preference (`apps/webapp/src/ui/byline/components/link/link-lexical.tsx`):

1. `document._resolved === false` → strip the `<a>` wrapper, render children as plain text.
2. `document.path` starts with `/` → use as-is (canonicalised by the walker).
3. `document.path` is a bare slug + `targetCollectionPath` present → generic compose `/${targetCollectionPath}/${path}`.
4. Neither — strip wrapper, render children.

Step 2 is the happy path post-walker. Step 3 is heal-on-write fallback for legacy nodes and picker-time-but-not-yet-walked sessions. Step 1 is the explicit unresolved-target signal (deleted, unpublished in the selected view, or row-hidden). Step 4 is the safety net. No two-slot ambiguity, no data migration required when adopting the new pipeline — every next save normalises the field.

**Why the picker does not compose the path itself.** Step 3's generic compose is wrong for any collection whose public route differs from its collection path — `/publications/0000152` where the real route is `/library/0000152`. It is tempting to fix this by calling `buildDocumentPath` in the link picker, which is possible: collection *definitions* are registered in the browser via `ClientConfig.collections`, so the hook is reachable client-side. Two things argue against it.

First, the value is not observable before save. No admin surface renders `document.path` — the floating link editor deliberately shows an admin edit URL (`floating-link-editor.tsx`), and the link modal shows the target's title. The only readers are the server-side walker, the markdown serializer, and the public renderer, all of which operate on saved or populated data.

Second, `record.fields` at pick time is only what `resolveSelectFields` asked the listing endpoint for (picker columns + `useAsTitle` + `displayField`). A hook reading anything outside that projection — like the `pages` hook's `area` — sees `undefined` and composes a confidently wrong path rather than an obviously generic one. That is a worse failure mode for a value the walker overwrites on the next save anyway.

This calculus would change if a host rendered unsaved editor state in a live preview pane. The prerequisite would be a way for a collection to declare which fields its `buildDocumentPath` needs, so the picker can request them — `extraSelectFields` is the existing mechanism, but nothing declarative feeds it today.

### Server-side embed and populate

Same Lexical visitor pipeline, two trigger points. The package ships two distinct factories that build the registered functions:

- **`lexicalEditorEmbedServer({ getClient })`** — produces a `RichTextEmbedFn`. The framework invokes it during `document-lifecycle` write paths (`createDocument`, `updateDocument`, `updateDocumentWithPatches`, `restoreDocumentVersion`, `duplicateDocument`, `copyToLocale`) for every richtext leaf whose effective `embedRelationsOnSave` is `true`.
- **`lexicalEditorPopulateServer({ getClient })`** — produces a `RichTextPopulateFn`. The framework invokes it during the read pipeline for every richtext leaf whose effective `populateRelationsOnRead` is `true`.

**Why this wiring lives in the host, not as a default.** Recipe 11 is explicit because `@byline/core` deliberately does not depend on `@byline/richtext-lexical`; a hard dependency would privilege Lexical and prevent another editor package from implementing the same contract. Validation can run only after `initBylineCore()` sees the registered adapters and collection set. The host is therefore the composition point. With default field flags (`embedRelationsOnSave: true`), `validateRichTextFieldFlags` throws at boot if either required adapter is absent. Core, not the editor package, owns target authorization and supplies each adapter invocation with the secure `readDocuments` capability.

**Where each phase fits in the lifecycle:**

```
Write path:  beforeCreate / beforeUpdate
              → assignCounterValues
              → embedRichTextFields           ← lexicalEditorEmbedServer
              → createDocumentVersion
              → afterCreate / afterUpdate

Read path:   findDocuments (DB) → reconstruct
              → populateDocuments
              → populateRichTextFields        ← lexicalEditorPopulateServer
              → applyAfterRead
```

Both adapters share the same context shape: `value`, `fieldPath`, `collectionPath`, `readContext`, `requestContext`, `readMode`, and `readDocuments`. The embed path starts a guarded read operation per save and resolves targets through the published view using the writing actor.

```ts
// packages/core/src/@types/field-types.ts
export interface RichTextEmbedContext {
  value: unknown                  // raw editor JSON, possibly stringified
  fieldPath: string               // 'body', 'content.0.caption', 'meta.summary', …
  collectionPath: string
  readContext: ReadContext
  requestContext: RequestContext
  readMode: ReadMode
  readDocuments: RichTextReadDocumentsFn
}
export type RichTextEmbedFn = (ctx: RichTextEmbedContext) => Promise<void>
// RichTextPopulateContext / RichTextPopulateFn mirror this exactly.
```

`readContext` is the same operation context the relation populate primitive uses. Adapter visitors must request target documents through `readDocuments`; direct DB access or an independently constructed client would bypass the target collection's ability, `beforeRead`, read-mode, and `afterRead` contracts.

**What the factories actually do.** Each composes every Lexical plugin's visitor into a single function. The package ships two visitors today — one per relation-bearing node type, shared between the two trigger points:

| Visitor | File | On `apply()` (target found) | On `applyMissing()` (target unresolved) |
|---|---|---|---|
| `linkVisitor` | `extensions/link/populate.ts` | Refreshes `attributes.document.title` from `useAsTitle`, composes `attributes.document.path` via `buildDocumentPath` (or generic fallback), clears any stale `_resolved` | Deletes `title` / `path`, sets `_resolved: false` |
| `inlineImageVisitor` | `extensions/inline-image/populate.ts` | Refreshes `node.document` with `{ title, altText, image, sizes }` | No-op (no explicit miss handler — node keeps its picker-time envelope) |

Both visitors are pure / framework-agnostic — no React, no DOM, no Lexical runtime. They live next to the plugin's UI code so each plugin's write-time embed and read-time populate stay in lockstep, but only the visitor module is reachable from the package's `server` entry. The shared driver (`runLexicalPopulate`) walks the value's Lexical tree once per call and dispatches across every visitor in a single pass. Pending target ids are batched per source collection and handed to core's secure reader.

**Multi-locale write caveat.** `restoreDocumentVersion` and `duplicateDocument` write with `locale: 'all'`, producing a multi-locale `{ <locale>: lexicalJson }` shape per localized richtext leaf. The Lexical adapter's `getLexicalRoot` can't parse that map as a single tree, so the embed walker silently no-ops for localized rich-text leaves on those paths. Non-localized leaves still refresh. The persisted state carries whatever the source had, and the renderer's fallback chain copes. Tracked as a deliberate future refinement (per-locale walking).

**Tight projection by design.** The visitors mirror exactly what the modals embed at picker time. Anything more ambitious crosses into "render arbitrary linked-doc fields inline" territory, which is a different feature.

**Custom visitors.** Both factories accept a `visitors` override for hosts that want to add a custom node type or temporarily disable a built-in:

```ts
lexicalEditorEmbedServer({
  getClient: getAdminBylineClient,
  visitors: [inlineImageVisitor, linkVisitor, myCustomVisitor],
})
```

**Rich-text-in-blocks.** `collectRichTextLeaves` recurses through `group` / `array` / `blocks` to find every richText field declared anywhere in the schema. For blocks specifically, it dispatches each data item by its `_type` to the matching `Block.fields` schema. So a `richTextBlock` instance inside a `content: blocks` field, or a `caption: richText` inside a `photoBlock`, is found and walked without any per-collection wiring or per-block opt-in.

| Schema layout | Yielded `fieldPath` |
|---|---|
| Top-level | `body` |
| Inside `group` | `meta.summary` |
| Inside `array` | `faq.0.answer` |
| Inside `blocks` (PhotoBlock caption) | `content.0.caption` |
| Inside `blocks` (RichTextBlock body) | `content.1.richText` |

**Generated exhaustive public rendering.** The reference app derives its renderable block union from both generated collection field types, rather than maintaining a hand-written list:

```ts
type ContentBlockOf<Fields extends { content?: unknown }> =
  NonNullable<Fields['content']> extends Array<infer Block> ? Block : never

type ContentBlock = ContentBlockOf<DocsFields> | ContentBlockOf<PagesFields>
```

The photo-population overlay distributes across that generated Docs + Pages union, preserving collection-specific block members. `RenderBlocks` then uses an exhaustive `switch (block._type)` for every known generated member; its default passes to a `never` reporter. The default still matters for persisted data authored under an older or newer schema: an unknown runtime `_type` is explicitly logged and omitted, while subsequent known blocks continue rendering. It is never sent to a convenient fallback component and misrendered as rich text. The same implementation is kept in the CLI UI template.

**Co-existence with relation-field populate.** Relation fields and richtext targets participate in the same guarded read operation. Both enforce target abilities, inherited source view, read budget, and `afterRead`; both reuse strict `beforeRead` filters compiled once per collection + mode within the authority-bound logical context. Cross-surface recursion or reuse across authorities fails closed instead of exposing an incompletely redacted target. The shipped Lexical visitors get this behavior by using the supplied `readDocuments` function.

**Why a flat envelope.** The persisted node attributes flatten the relation envelope directly (`targetDocumentId`, `targetCollectionId`, `targetCollectionPath`, `document?`). This matches the `RelationField` value shape; freshness is selected explicitly through the save-time embed and read-time populate flags.

### Worked example — the AI plugin end-to-end

The `@byline/ai/plugins/lexical` package is the canonical third-party example. It ships:

- `AiPluginLexical` — the React component (drawer + command listener) the extension mounts.
- `AiLexicalExtension` — a `defineExtension(...)` that wraps it. The extension declares `peerDependencies: [declarePeerDependency(BylineToolbarExtension, { items: [...] })]` for the toolbar button and `dependencies: [configExtension(ReactExtension, { decorators: [<AiPluginLexical key="d" />] })]` for the drawer mount.

The host (`apps/webapp/byline/fields/richtext/lexical-richtext-ai.tsx`) is then a one-liner:

```tsx
export const LexicalRichTextAi = lexicalEditor((c) => {
  c.extensions.add(AiLexicalExtension)
  return c
})
```

No `featureAfterEditor` injection, no React-context registry hop — the extension graph does both jobs. The toolbar button arrives via the peer-dependency contract; the drawer arrives via `ReactExtension.decorators`. The same shape is what every third-party extension follows.

---

## Current limitations

- **One editor at a time, site-wide.** The editor slot is registered once for the
  whole installation (Lexical, via `@byline/richtext-lexical`). Per-collection or
  per-field editor *selection* is not built; the per-field `Field` component slot is
  the escape hatch when one field needs a different input.
- **Multi-locale write-walking caveat.** On `restoreDocumentVersion` and
  `duplicateDocument`, localized rich-text leaves are written as a multi-locale
  `{ <locale>: lexicalJson }` map, and the server-side embed walker no-ops for those
  leaves (it cannot parse the map as a single tree). Non-localized leaves still
  refresh, and the renderer falls back to the embed envelope the source carried, so
  a restored document still renders correctly.

## Code map

| Concern | Location |
|---|---|
| `RichTextEditorProps` / `RichTextEditorComponent` contract | `packages/core/src/@types/field-types.ts` |
| `RichTextPopulateFn` / `RichTextPopulateContext` contract | `packages/core/src/@types/field-types.ts` |
| Secure `RichTextReadDocumentsFn` contract | `packages/core/src/@types/field-types.ts` |
| Secure target-reader implementation | `packages/core/src/services/richtext-populate.ts` (`createRichTextDocumentReader`) |
| `RichTextField.editorConfig` opaque slot | `packages/core/src/@types/field-types.ts` |
| `embedRelationsOnSave` / `populateRelationsOnRead` flags | `packages/core/src/@types/field-types.ts` |
| `ClientConfig.fields.richText.editor` slot | `packages/core/src/@types/site-config.ts` |
| `ServerConfig.fields.richText.populate` slot | `packages/core/src/@types/site-config.ts` |
| Renderer dispatch | `packages/admin/src/fields/field-renderer.tsx` (`case 'richText'`) |
| Lexical editor package — UI entry | `packages/richtext-lexical/src/index.ts` |
| Lexical editor package — server entry | `packages/richtext-lexical/src/server.ts` |
| `lexicalEditor()` registration factory | `packages/richtext-lexical/src/lexical-editor.tsx` |
| `lexicalEditorEmbedServer()` / `lexicalEditorPopulateServer()` factories | `packages/richtext-lexical/src/server.ts` |
| Default editor settings (server-safe) | `packages/richtext-lexical/src/field/config/default.ts` |
| Default extensions list (client-only) | `packages/richtext-lexical/src/field/config/default-extensions.ts` |
| `ExtensionsList` chainable wrapper | `packages/richtext-lexical/src/field/config/extensions-list.ts` |
| `EditorConfig` / `EditorSettings` types | `packages/richtext-lexical/src/field/config/types.ts` |
| `BylineToolbarExtension` + `selectToolbarItems` | `packages/richtext-lexical/src/field/extensions/byline-toolbar/` |
| `BylineFloatingUIExtension` + `selectFloatingUIItems` | `packages/richtext-lexical/src/field/extensions/byline-floating-ui/` |
| `FloatingTextFormatExtension` (standalone) | `packages/richtext-lexical/src/field/extensions/floating-text-format/` |
| `ToolbarActiveEditorProvider` / `useToolbarActiveEditor` | `packages/richtext-lexical/src/field/plugins/toolbar-plugin/toolbar-active-editor.tsx` |
| Toolbar consumer (reads contributed items) | `packages/richtext-lexical/src/field/plugins/toolbar-plugin/index.tsx` |
| Editor-context composition (root extension) | `packages/richtext-lexical/src/field/editor-context.tsx` |
| Editor.tsx (mounts floating UIs from the registry) | `packages/richtext-lexical/src/field/editor.tsx` |
| Markdown source toggle (state provider) | `packages/richtext-lexical/src/field/context/markdown-mode-context.tsx` |
| Markdown source toggle (conversion + root guard hook) | `packages/richtext-lexical/src/field/hooks/use-markdown-toggle.ts` |
| Byline markdown transformers (`BYLINE_TRANSFORMERS`, table + admonition) | `packages/richtext-lexical/src/field/markdown/transformers.ts` |
| One-way export serializer (`lexicalToMarkdown`, see [Markdown Export](../05-reading-and-delivery/04-markdown-export.md)) | `packages/richtext-lexical/src/field/markdown/lexical-to-markdown.ts` |
| `markdownToggle` editor setting | `packages/richtext-lexical/src/field/config/types.ts` |
| Byline `TableExtension` (incl. action-menu floating UI) | `packages/richtext-lexical/src/field/extensions/table/` |
| Byline `HorizontalRuleExtension` wrapper | `packages/richtext-lexical/src/field/extensions/horizontal-rule/` |
| Link extension (UI + extension + floating editor) | `packages/richtext-lexical/src/field/extensions/link/` |
| Link extension (populate visitor) | `packages/richtext-lexical/src/field/extensions/link/populate.ts` |
| Inline-image extension (UI + extension) | `packages/richtext-lexical/src/field/extensions/inline-image/` |
| Inline-image extension (populate visitor) | `packages/richtext-lexical/src/field/extensions/inline-image/populate.ts` |
| Admonition / Layout / Auto-embed / Code-highlight | `packages/richtext-lexical/src/field/extensions/{admonition,layout,auto-embed,code-highlight}/` |
| Shared envelope type | `packages/richtext-lexical/src/field/nodes/document-relation.ts` |
| Shared tree walker / batch driver | `packages/richtext-lexical/src/field/lexical-populate-shared.ts` |
| `populateRichTextFields` service + leaf walker | `packages/core/src/services/richtext-populate.ts` |
| Boot-time validation | `packages/core/src/services/richtext-populate.ts` (`validateRichTextFieldFlags`) |
| Read-pipeline integration (sources) | `packages/client/src/collection-handle.ts` |
| Read-pipeline integration (populated targets) | `packages/core/src/services/populate.ts` |
| `linksInEditor` collection flag | `packages/core/src/@types/collection-types.ts` |
| AI plugin Lexical extension (worked third-party example) | `packages/ai/src/plugins/lexical/extension.tsx` |
| Per-field component override | `FieldComponentSlots.Field` in `packages/core/src/@types/field-types.ts` |
| Worked compact custom field (settings only) | `apps/webapp/byline/fields/richtext/lexical-richtext-compact.ts` |
| Worked per-field AI editor (`aiRichTextAdmin`) | `apps/webapp/byline/fields/richtext/lexical-richtext-ai.tsx` |
| Reference registration (client) | `apps/webapp/byline/admin.config.ts` |
| Reference registration (server) | `apps/webapp/byline/server.config.ts` |
