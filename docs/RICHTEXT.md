---
title: "Rich Text Editor"
path: "richtext"
summary: "Byline's Lexical-based rich text editor: the extension API, built-in nodes (links, inline images, admonitions, layout, code, tables), and the runtime serializer pipeline."
---

# Rich Text Editor

Companions:
- [CORE-COMPOSITION.md](./CORE-COMPOSITION.md) — the broader roadmap for how Byline composes adapter packages (db, storage, session, editors).
- [RELATIONSHIPS.md](./RELATIONSHIPS.md) — the relation-field primitive that richtext links and inline images are layered on top of.

## Overview

Byline's richtext is pluggable through a deliberately small adapter contract. Today the project ships one editor — `@byline/richtext-lexical` — built on Lexical. The cross-editor contract (a client render component and a server populate function) stays minimal so a future TipTap or markdown adapter can fit the same shape. On top of that, the Lexical adapter exposes a **BYO-extension surface** built on Lexical's [Extensions API](https://lexical.dev/docs/extensions/intro) — site authors and third parties register Lexical extensions through a chainable list and contribute toolbar / floating-UI items through typed peer dependencies on `BylineToolbarExtension` and `BylineFloatingUIExtension`.

`@byline/ui` no longer depends on Lexical at all. `@byline/richtext-lexical` ships two entry points — the default export is the React render surface; `@byline/richtext-lexical/server` is the server populate factory.

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
        c.settings.options.markdownShortcutPlugin = true
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
// apps/webapp/byline/fields/lexical-richtext-ai.tsx
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

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts` (use) and `apps/webapp/byline/fields/lexical-richtext-compact.ts` (the helper itself).

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

Per-field policy for relation-bearing nodes (internal links, inline images). Defaults to **snapshot** (`embedRelationsOnSave: true`).

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
fields: [
  { name: 'body', type: 'richText' },                                 // snapshot (default)
  { name: 'caption', type: 'richText',
    embedRelationsOnSave: false },                                    // storage-thin, requires server adapter
  { name: 'callout', type: 'richText',
    embedRelationsOnSave: true, populateRelationsOnRead: true },      // belt-and-braces
]
```

→ [Relations — embed and populate](#relations--embed-and-populate)

### 11. Register the server populate function

One opt-in line at boot enables read-time refresh of embedded link / inline-image relations across every richText field in every collection. Required when any field sets `embedRelationsOnSave: false` or explicitly `populateRelationsOnRead: true`.

**Edit:** `apps/webapp/byline/server.config.ts`

```ts
import { lexicalEditorServer } from '@byline/richtext-lexical/server'
import { getAdminBylineClient } from '@byline/host-tanstack-start/integrations/byline-client'

await initBylineCore({
  // …db, collections, storage, sessionProvider, adminStore, …
  fields: {
    richText: { populate: lexicalEditorServer({ getClient: getAdminBylineClient }) },
  },
})
```

→ [Server-side populate](#server-side-populate)

---

## Architecture

### The adapter surface

Five things compose the present surface:

1. **The render-component contract** — `RichTextEditorComponent` in `@byline/core`.
2. **The client-side slot** — `ClientConfig.fields.richText.editor`. Registered once in `apps/webapp/byline/admin.config.ts`.
3. **The server-side populate contract** — `RichTextPopulateFn` in `@byline/core`. Pure, framework-agnostic.
4. **The server-side slot** — `ServerConfig.fields.richText.populate`. Registered once in `apps/webapp/byline/server.config.ts`.
5. **An opaque per-field config slot** — `RichTextField.editorConfig?: unknown`. Each editor adapter owns its own config shape; `@byline/core` does not interpret it.

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
```

`@byline/richtext-lexical` exports both `RichTextField` (component matching `RichTextEditorComponent` directly) and `lexicalEditor()` (a registration factory that bakes settings + extensions in via a closure). Either form satisfies the slot. Alternative editor packages (`@byline/richtext-tiptap`, `@byline/richtext-md`, …) only need a component matching `RichTextEditorComponent`.

**Renderer dispatch.** `packages/ui/src/fields/field-renderer.tsx` reads the configured editor at render time and throws if none is registered. The throw is the failure mode by design — a `richText` field with no editor is unusable, and loud first-render feedback beats a silent textarea fallback.

**Per-field override precedence.** `FieldComponentSlots.Field` overrides win over the site-wide default. `FieldAdminConfig.editor` (recipe 8) is the typed convenience for "this field needs a different editor entirely."

**Why `editorConfig` stays opaque.** Lexical, TipTap, and ProseMirror don't share a feature graph. Each editor adapter owns its own config shape and its own cast at its own boundary. A shared feature-graph contract is [a future phase](#future-phases), not today's design.

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

**The toolbar plugin** (the fixed row above the content-editable) is a *consumer* of `BylineToolbarExtension`, not a contributor. It needs a fixed DOM position the decorator slot can't express, so it lives in `Editor.tsx` directly. If we ever want it under the extension graph an Output Component pattern works; not currently a pain point.

### Relations — embed and populate

The link and inline-image nodes are the editor's two relation-bearing node types — the first non-form consumers of Byline's `DocumentRelation` envelope. They have a per-field policy for how target document data flows in and out.

**Two strategies, paired per field:**

| Phase | What it does | Field flag | Default |
|---|---|---|---|
| **Embed** | At pick / save time, the modal copies a small projection of the target's fields into the persisted Lexical JSON. | `embedRelationsOnSave` | `true` |
| **Populate** | At read time, the framework refreshes embedded data by calling the registered server adapter. | `populateRelationsOnRead` | `!embedRelationsOnSave` |

**Four meaningful states:**

| `embedRelationsOnSave` | `populateRelationsOnRead` (effective) | Behaviour |
|---|---|---|
| `true` (default) | `false` (default-derived) | **Snapshot.** Embed at write, render embedded data. Cheapest reads; accept staleness. |
| `false` | `true` (default-derived) | **Storage-thin.** Persist relation primary keys only; populate on every read. Always fresh; highest read cost. |
| `true` (explicit) | `true` (explicit) | **Belt-and-braces.** Embed at write *and* refresh on read. Snapshot is the fallback if populate is ever skipped. |
| `false` | `false` | **Invalid.** `initBylineCore()` throws — the field would be unrenderable. |

`initBylineCore()` also throws when any field has effective `populateRelationsOnRead === true` but no server adapter is registered on `ServerConfig.fields.richText.populate`. Fail-fast at boot beats a silent broken renderer at request time.

**What gets embedded at picker time:**

- **Internal link** — `{ title, path }`. `title` comes from the target collection's `useAsTitle` field; `path` is top-level metadata on every document. Together these are everything a public renderer needs to build `<a href={path}>{title}</a>`.
- **Inline image** — `{ title, altText, image, sizes }`. `image` is the source media's `StoredFileValue`; `sizes` is `deriveImageSizes(image.variants)` flattened into a renderer-friendly `{ name, url, width, height, format }[]`. Top-level `src` / `width` / `height` / `altText` are also persisted on the inline-image node — Lexical needs them to render in the admin editor, and they remain a usable fallback when populate hasn't run.

**Persisted shapes.** Two slightly different on-disk layouts, same envelope:

```ts
// Link node — relation envelope nested under `attributes`.
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
      document?: Record<string, any>  // ← `{ title, path }` at picker time
    }
```

```ts
// Inline-image node — relation envelope flattened directly onto the node.
export type SerializedInlineImageNode = Spread<
  DocumentRelation & {
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

The two layouts differ for historical / Lexical-mechanics reasons (the link node extends `ElementNode` and wraps its custom attrs in `attributes`; the inline-image node spreads them flat). Both carry the same `DocumentRelation` shape — the visitor abstraction in `lexical-populate-shared.ts` papers over the difference. `document` is **advisory** in either layout — renderers must tolerate it being absent.

### Server-side populate

Picker-time embed alone is correct for the snapshot default. For read-time freshness — required for `embedRelationsOnSave: false`, useful for belt-and-braces — register the Lexical adapter's server entry point on `ServerConfig.fields.richText.populate` (recipe 11). One opt-in line; every richtext field across every collection follows its own per-field policy automatically, including rich-text fields nested inside `group` / `array` / `blocks`.

**Where it fits in the read pipeline.** The new phase slots between relation populate and user-land `afterRead`:

```
findDocuments (DB) → reconstruct → populateDocuments → populateRichTextFields → applyAfterRead
```

For each document — both source documents from the top-level read and materialised relation targets reached during populate — the framework walks the field tree, yields every richtext leaf, gates each leaf by its effective `populateRelationsOnRead`, and calls the registered populate function. The function mutates the value in place; the framework reads the mutated value back when shaping the response.

```ts
// packages/core/src/@types/field-types.ts
export interface RichTextPopulateContext {
  value: unknown                  // raw editor JSON, possibly stringified
  fieldPath: string               // 'body', 'content.0.caption', 'meta.summary', …
  collectionPath: string
  readContext: ReadContext        // shared with relation populate / afterRead
}
```

`readContext` is the same request-scoped context the relation populate primitive uses. Adapters that perform their own reads must thread it through (`client.collection(...).find({ _readContext: readContext })`) — visited-set / read-budget / `afterReadFired` machinery covers richtext fan-out and any nested reads automatically.

**What `lexicalEditorServer()` actually does.** Composes every Lexical plugin's populate visitor into a single `RichTextPopulateFn`. The package ships two visitors today — one per relation-bearing node type:

| Visitor | File | Refreshes |
|---|---|---|
| `inlineImageVisitor` | `extensions/inline-image/populate.ts` | `node.document` ← `{ title, altText, image, sizes }` |
| `linkVisitor` | `extensions/link/populate.ts` | `attributes.document` ← `{ title, path }` (only when `linkType: 'internal'`) |

Both visitors are pure / framework-agnostic — no React, no DOM, no Lexical runtime. They live next to the plugin's UI code so each plugin's write-time embed and read-time populate stay in lockstep, but only the populate file is reachable from the package's `server` entry. The shared driver (`runLexicalPopulate`) walks the value's Lexical tree once per call and dispatches across every visitor in a single pass. Pending hydrations are batched per source collection — one `find({ where: { id: { $in: ids } } })` per collection in parallel.

**Tight projection by design.** The visitors mirror exactly what the modals embed at picker time. Anything more ambitious crosses into "render arbitrary linked-doc fields inline" territory, which is a different feature.

**Custom visitors.** The factory accepts a `visitors` override for hosts that want to add a custom node type or temporarily disable a built-in:

```ts
lexicalEditorServer({
  getClient: getAdminBylineClient,
  visitors: [inlineImageVisitor, linkVisitor, myCustomEmbedVisitor],
})
```

**Rich-text-in-blocks.** `collectRichTextLeaves` recurses through `group` / `array` / `blocks` to find every richText field declared anywhere in the schema. For blocks specifically, it dispatches each data item by its `_type` to the matching `Block.fields` schema. So a `richTextBlock` instance inside a `content: blocks` field, or a `caption: richText` inside a `photoBlock`, is found and populated without any per-collection wiring or per-block opt-in.

| Schema layout | Yielded `fieldPath` |
|---|---|
| Top-level | `body` |
| Inside `group` | `meta.summary` |
| Inside `array` | `faq.0.answer` |
| Inside `blocks` (PhotoBlock caption) | `content.0.caption` |
| Inside `blocks` (RichTextBlock body) | `content.1.richText` |

**Co-existence with relation-field populate.** When a `RelationField` on the same collection points at the same target document a richtext node references, both flow through the same `ReadContext`. The visited set collapses the two targets into **one** materialisation; A→B→A cycles between richtext links and relation fields hit the same cycle marker (renderers see `_resolved: false` or `_cycle: true` instead of recursing). Automatic as long as the populate function threads `readContext` through to its `client.collection(...).find({ _readContext })` calls — `lexicalEditorServer()` and the shipped visitors do.

**Why a flat envelope, not a `cached` wrapper.** The persisted node attributes flatten the relation envelope directly (`targetDocumentId`, `targetCollectionId`, `targetCollectionPath`, `document?`). This matches the `RelationField` value shape verbatim — same information, one fewer layer of nesting than an earlier `{ cached: { ... } }` design. A `cachedAt` ISO marker was considered for staleness windows but dropped; populate overrides the embedded values when wired anyway.

### Worked example — the AI plugin end-to-end

The `@byline/ai/plugins/lexical` package is the canonical third-party example. It ships:

- `AiPluginLexical` — the React component (drawer + command listener) the extension mounts.
- `AiLexicalExtension` — a `defineExtension(...)` that wraps it. The extension declares `peerDependencies: [declarePeerDependency(BylineToolbarExtension, { items: [...] })]` for the toolbar button and `dependencies: [configExtension(ReactExtension, { decorators: [<AiPluginLexical key="d" />] })]` for the drawer mount.

The host (`apps/webapp/byline/fields/lexical-richtext-ai.tsx`) is then a one-liner:

```tsx
export const LexicalRichTextAi = lexicalEditor((c) => {
  c.extensions.add(AiLexicalExtension)
  return c
})
```

No `featureAfterEditor` injection, no React-context registry hop — the extension graph does both jobs. The toolbar button arrives via the peer-dependency contract; the drawer arrives via `ReactExtension.decorators`. The same shape is what every third-party extension follows.

---

## Future phases

Concrete next steps, roughly ordered by likely sequence. None committed to a timeline.

### Phase 2 — A second editor package

The single most useful next step is the **existence of a second editor package** — almost certainly `@byline/richtext-tiptap` or a markdown-focused `@byline/richtext-md`. Until that exists, every adapter-shape question is one-sided. A second package will surface the real questions:

- Is `RichTextEditorProps` enough, or are editors hitting its limits?
- Do they share *anything* in the way they want to expose features?
- What does the per-instance `editorConfig` prop look like across editors, and is the variance painful enough to warrant a normalised shape?
- Where do per-editor stylesheet conventions and theme tokens live?

A second package is also where the test for *whether to grow the contract* becomes empirical rather than speculative.

### Phase 3a — Server-side populate primitive (shipped)

The richtext adapter has a server-side populate function called by the framework's read pipeline. Embedded relation envelopes are refreshed against their source documents before user-land `afterRead` fires. See [Server-side populate](#server-side-populate).

### Phase 3b — User-land editor lifecycle hooks (deferred)

Other CMS frameworks expose per-editor lifecycle hooks — typically `beforeChange`, `afterChange`, `beforeRead`, `serialize`, `deserialize` — that fire as the document moves through the field pipeline. Useful when an editor needs to transform its serialized output before storage, rehydrate a stored shape into the editor's runtime state on read, run validation that depends on the editor's internal model, or emit derived data (excerpt, plain-text projection, search payload, TOC).

Byline already has analogous hooks one level up — `FieldHooks.beforeValidate` / `beforeChange` on every field, plus collection-level `beforeRead` / `afterRead` / `beforeChange` / `afterChange`. The question is whether a future editor needs its own pipeline distinct from the field-level one. Lexical's serialized state round-trips through the existing `validate` and field hooks without help. If a second editor surfaces a real need, that becomes the moment to design the editor-level pipeline against two concrete shapes rather than one. Pipeline ordering relative to field and collection hooks is the design question that matters most — the likely answer is *editor hooks fire innermost*, but that should be confirmed against two implementations.

### Phase 4 — Feature-graph configuration

If two or more editor packages settle into compatible feature shapes — or a real installation needs to express feature parity across editors — design a shared feature-graph contract. Until that pressure exists, every editor's configuration stays opaque.

### Phase 5 — Editor-side server pipeline

Independent of the adapter shape: derived projections from rich text content (search payload, excerpt, plain-text fallback for SSR, structured outline) are useful enough to deserve their own design pass once the search / indexing story takes shape. More naturally a concern of `@byline/core/services` than the editor adapter, but the adapter is the boundary that knows how to traverse its own document tree.

### Phase 6 — Per-collection / per-field editor selection

Today's slot is site-wide. A future phase may want to register an editor per collection or per field — for example, a markdown editor in a documentation collection and Lexical elsewhere. The existing `FieldComponentSlots.Field` already provides the per-field escape hatch and works today; a more structured per-collection or per-field selection is only worth designing once there's a clear product reason.

### Phase 7 — Extensibility (shipped)

`@byline/richtext-lexical` exposes a BYO-extension surface so installations can add their own Lexical nodes / plugins without forking the package. All four sub-pieces shipped:

1. **Unified extensions list** — the root extension's `dependencies` array is sourced from `editorConfig.extensions.toArray()`. See [Editor settings and extensions](#editor-settings-and-extensions).
2. **`BylineToolbarExtension` contract** — typed Lexical extension; built-ins and third parties contribute via `peerDependencies`. See [The toolbar registry](#the-toolbar-registry).
3. **`BylineFloatingUIExtension` registry** — mirror of the toolbar registry for floating UIs. The three built-in floating UIs migrated to peer contributions; per-plugin boolean toggles were dropped (suppression is now `c.extensions.remove(...)`); `TableActionMenuPlugin` reads `hasCellMerge` from the upstream Lexical table extension. See [The floating-UI registry](#the-floating-ui-registry).
4. **Extensions README** — in-tree pointer at `packages/richtext-lexical/src/field/extensions/README.md` deep-links back to the recipes above.

This phase is Lexical-specific. A second editor package (Phase 2) would have its own extensibility surface shaped by its own plugin model; the Phase 7 design here doesn't generalise to TipTap or ProseMirror.

---

## Code map

| Concern | Location |
|---|---|
| `RichTextEditorProps` / `RichTextEditorComponent` contract | `packages/core/src/@types/field-types.ts` |
| `RichTextPopulateFn` / `RichTextPopulateContext` contract | `packages/core/src/@types/field-types.ts` |
| `RichTextField.editorConfig` opaque slot | `packages/core/src/@types/field-types.ts` |
| `embedRelationsOnSave` / `populateRelationsOnRead` flags | `packages/core/src/@types/field-types.ts` |
| `ClientConfig.fields.richText.editor` slot | `packages/core/src/@types/site-config.ts` |
| `ServerConfig.fields.richText.populate` slot | `packages/core/src/@types/site-config.ts` |
| Renderer dispatch | `packages/ui/src/fields/field-renderer.tsx` (`case 'richText'`) |
| Lexical editor package — UI entry | `packages/richtext-lexical/src/index.ts` |
| Lexical editor package — server entry | `packages/richtext-lexical/src/server.ts` |
| `lexicalEditor()` registration factory | `packages/richtext-lexical/src/lexical-editor.tsx` |
| `lexicalEditorServer()` registration factory | `packages/richtext-lexical/src/server.ts` |
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
| Worked compact custom field (settings only) | `apps/webapp/byline/fields/lexical-richtext-compact.ts` |
| Worked per-field AI editor (`aiRichTextAdmin`) | `apps/webapp/byline/fields/lexical-richtext-ai.tsx` |
| Reference registration (client) | `apps/webapp/byline/admin.config.ts` |
| Reference registration (server) | `apps/webapp/byline/server.config.ts` |
