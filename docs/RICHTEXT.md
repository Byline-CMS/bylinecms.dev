# Rich Text Editor

> Companions:
> - [CORE-COMPOSITION.md](./CORE-COMPOSITION.md) — the broader roadmap for how Byline composes adapter packages (db, storage, session, and now editors).
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — the relation-field primitive that richtext links and inline images are layered on top of. Read this doc first; this one extends it with the editor-side denormalisation strategy.

## Overview

Byline's richtext editing is **pluggable through a deliberately small adapter contract**. Today the project ships one editor package — `@byline/richtext-lexical` — built on Lexical. The contract has two halves: a **client-side render component** (`ClientConfig.fields.richText.editor`) and a **server-side populate function** (`ServerConfig.fields.richText.populate`). Each adapter implements both; the framework manages the registration sites and the runtime that calls them.

The contract stays deliberately small everywhere it can. Other CMS frameworks ship a substantial editor-adapter API — editor-specific lifecycle hooks (`beforeChange` / `afterChange` / `beforeRead` / `serialize` / `deserialize`), a feature graph that toggles plugins on or off, and a runtime that orchestrates them alongside the rest of the field pipeline. That is a powerful surface but a meaningful design commitment, and one that is much easier to *shape* against multiple real editor implementations than to *guess* against one. Byline grows the contract only when a real product need forces a specific shape — Phase 3a (this work) adds the server-side populate primitive because rich-text relations can't be made correct without it; user-land lifecycle hooks (Phase 3b) stay deferred until a second editor implementation reveals what they should look like.

Five things compose the present surface:

1. **The render-component contract** — `RichTextEditorComponent` in `@byline/core`. Mirrors what `field-renderer.tsx` already passes for `type: 'richText'` fields.
2. **The client-side slot** — `ClientConfig.fields.richText.editor`. Registered once, used everywhere a `richText` field renders.
3. **The server-side populate contract** — `RichTextPopulateFn` in `@byline/core`. Pure, framework-agnostic. The framework's read pipeline calls it once per rich-text leaf it discovers in a document tree.
4. **The server-side slot** — `ServerConfig.fields.richText.populate`. Registered once, used to refresh embedded relation envelopes on every read.
5. **An opaque per-field config slot** — `RichTextField.editorConfig?: unknown`. Each editor adapter owns its own config shape; `@byline/core` does not interpret it.

`@byline/ui` no longer depends on Lexical at all. `@byline/richtext-lexical` ships two entry points: the default export carries the React render surface; `@byline/richtext-lexical/server` carries the server populate function. The subpath split keeps client bundles free of server populate code and vice versa.

Beyond the framework-agnostic contract above, `@byline/richtext-lexical` exposes a **BYO-extension surface** built on Lexical's [Extensions API](https://lexical.dev/docs/extensions/intro). Site authors and third parties register Lexical extensions into the editor's dependency graph through a chainable `ExtensionsList` API, and contribute toolbar items via a typed peer-dependency on `BylineToolbarExtension`. This surface is genuinely Lexical-specific (a future TipTap or ProseMirror adapter would have its own); the cross-editor contract above stays minimal. See [Extensibility](#extensibility--extensions-list-settings-and-toolbar-contributions) below for the full reference and recipes.

## The contract

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

## The slot

```ts
// packages/core/src/@types/site-config.ts (excerpt)

export interface ClientConfig extends BaseConfig {
  admin?: CollectionAdminConfig[]
  fields?: {
    richText?: { editor: RichTextEditorComponent }
  }
}
```

`fields` is namespaced rather than flat so additional field-level defaults (custom widgets, formatters, etc.) can be registered there as the system grows, without each one negotiating a top-level config key.

## Registration

```ts
// apps/webapp/byline/admin.config.ts

import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  // ...
  fields: {
    richText: { editor: lexicalEditor() },
  },
})
```

`@byline/richtext-lexical` exports `RichTextField` directly as the component matching `RichTextEditorComponent` and `lexicalEditor()` as a registration factory that bakes editor settings in via a closure. Either form satisfies the slot. Alternative editor packages (a future `@byline/richtext-tiptap` or `@byline/richtext-md`) only need to export a component matching the same contract.

## Renderer behaviour

`packages/ui/src/fields/field-renderer.tsx` reads the configured editor at render time:

```tsx
case 'richText': {
  const RichTextEditor = getClientConfig().fields?.richText?.editor
  if (!RichTextEditor) {
    throw new Error(
      'No richText editor registered. Install @byline/richtext-lexical and set ' +
        '`fields.richText.editor` in your admin config (byline/admin.config.ts).'
    )
  }
  return (
    <RichTextEditor
      field={hideLabel ? { ...field, label: undefined } : field}
      defaultValue={defaultValue}
      onChange={handleChange}
      path={path}
      instanceKey={htmlId}
      locale={isLocalised ? contentLocale : undefined}
    />
  )
}
```

The throw is the failure mode by design. A `richText` field with no editor configured is unusable; loud, fast feedback at first render is the right behaviour rather than a silent textarea fallback that could ship to production unnoticed.

Per-field `FieldComponentSlots.Field` overrides keep precedence over the site-wide default — the existing per-field component override mechanism handles the "this one field needs a different editor entirely" case without a new override layer.

## Extensibility — extensions list, settings, and toolbar contributions

The Lexical adapter's configuration has two distinct parts that fall out of where they need to be evaluated:

- **`settings`** — booleans, strings, the inline-image upload collection. JSON-safe, allowed to ride along with a `RichTextField` in the schema, survives tsx-loaded seeds and SSR.
- **`extensions`** — a chainable `ExtensionsList` of Lexical extensions wired into the editor's dependency graph. Carries function references and React decorators, *not* JSON-safe; only meaningful at registration time (`lexicalEditor((c) => ...)`) or inside a client-only wrapper component, never persisted into a schema.

The wrapper in `@byline/richtext-lexical` resolves the full config at render time in priority order:

1. **`field.editorConfig`** — most specific. The schema author opted in for this field. Settings only — if it omits `extensions`, the package default is materialised at render.
2. **`editorConfig` baked in via `lexicalEditor(configure)`** at registration. May customise both `settings` and `extensions`.
3. **`defaultEditorConfig` + `defaultExtensionsList()`** — package fallbacks.

`RichTextField.editorConfig` is still typed `unknown` in `@byline/core`. The shape is opaque to core — each editor adapter defines what it accepts. The Lexical adapter casts at its own boundary in `richtext-field.tsx`. This stays unchanged because the cross-editor contract has no opinion on plugin models.

### The chainable extensions API

Inside `lexicalEditor((c) => ...)` the seed always carries an `ExtensionsList` populated with every Byline built-in. Mutations to `c.extensions` are local to that one call — the next registration starts fresh.

```ts
// All four methods return `this`, so they chain.

c.extensions.add(extension)                       // push to the end
c.extensions.remove(extension)                    // remove by name (no-op if absent)
c.extensions.replace(oldExtension, newExtension)  // preserve position
c.extensions.configure(extension, config)         // re-wrap with configExtension(extension, config)
c.extensions.has(extension)                       // boolean test by name
```

Comparison is by extension `name` (Lexical's own dedup key), so a bare `LinkExtension` and a `configExtension(LinkExtension, {...})` tuple are treated as the same entry. Trying to add two extensions with the same name throws at composer-build time — that's Lexical's behaviour, and it's the right failure mode: you replace built-ins via `remove(...)` + `add(yours)`, not by name collision.

### Recipes

#### 1. Default registration

Every `richText` field gets the full feature set.

```ts
// apps/webapp/byline/admin.config.ts
import { RichTextField } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: { editor: RichTextField },
  },
})
```

#### 2. Site-wide settings overrides

Override package settings via `lexicalEditor` — for purely-settings tweaks no extension manipulation is needed.

```ts
import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.settings.placeholderText = 'Start writing…'
        c.settings.options.markdownShortcutPlugin = true
        c.settings.options.debug = true
        return c
      }),
    },
  },
})
```

#### 3. Removing built-in extensions

Drop features the installation never wants.

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

The matching toolbar items disappear automatically — they're contributed via `peerDependencies` on `BylineToolbarExtension`, and Lexical only delivers contributions from extensions that are actually in the graph. The block-format dropdown likewise hides Bullet/Numbered list, Check List, and Code Block entries when the relevant extension isn't present (`useOptionalExtensionDependency` gating).

#### 4. Configuring a built-in extension

Override the upstream config of a wrapped extension (`TableExtension` here delegates to `@lexical/table`'s `TableExtension` with cell-merge / cell-background-color knobs).

```ts
import { lexicalEditor, TableExtension } from '@byline/richtext-lexical'
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

`InlineImageExtension`'s collection slot is the same pattern — you can override the editor-context's auto-wiring (which forwards `settings.inlineImageUploadCollection`) for a single registration:

```ts
c.extensions.configure(InlineImageExtension, { collection: 'media-2024' })
```

#### 5. Adding a third-party extension

The simplest case — an extension that just registers commands or behaviour, no UI surface.

```ts
import { lexicalEditor } from '@byline/richtext-lexical'
import { MyCustomExtension } from '@my-org/lexical-myfeature'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.extensions.add(MyCustomExtension)
        return c
      }),
    },
  },
})
```

#### 6. Authoring an extension that contributes a toolbar button

Toolbar items come through Lexical's peer-dependency mechanism. Your extension declares an optional peer on `BylineToolbarExtension` and supplies an `items` array. The toolbar plugin reads the merged list at render time.

```tsx
// @my-org/lexical-callout/src/extension.tsx
import {
  BylineToolbarExtension,
  type BylineToolbarConfig,
  useToolbarActiveEditor,
} from '@byline/richtext-lexical'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { configExtension, declarePeerDependency, defineExtension } from 'lexical'

import { CalloutNode } from './callout-node'
import { CalloutModal, INSERT_CALLOUT_COMMAND } from './callout-modal'

function CalloutInsertItem(): React.JSX.Element {
  // Use the active editor (handles nested composers correctly).
  const editor = useToolbarActiveEditor()
  return (
    <button
      type="button"
      onClick={() => editor.dispatchCommand(INSERT_CALLOUT_COMMAND, undefined)}
    >
      Insert callout
    </button>
  )
}

export const CalloutExtension = defineExtension({
  name: '@my-org/lexical-callout/Callout',
  nodes: () => [CalloutNode],
  dependencies: [configExtension(ReactExtension, { decorators: [<CalloutModal key="d" />] })],
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@my-org/lexical-callout/Callout/insert',
          placement: 'insert-menu',  // 'toolbar' for top-level
          order: 100,
          node: <CalloutInsertItem />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
  ],
})
```

Then register it the same way as any built-in:

```ts
defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.extensions.add(CalloutExtension)
        return c
      }),
    },
  },
})
```

**Contract details:**

- `placement: 'toolbar'` appends to the main row, after the built-in format buttons. `placement: 'insert-menu'` adds to the "Insert" dropdown, which only renders when at least one insert-menu contribution is present.
- `order` is the sort key within a placement (lower first). Built-ins use 10/20/30/40/50/60 for horizontal-rule / layout / admonition / inline-image / table / embeds; pick something outside that range to avoid surprise re-orderings if a built-in shifts.
- `id` doubles as the React key — convention is `<extension-name>/<purpose>` for uniqueness across third parties.
- The contributed `node` renders inside `ToolbarActiveEditorProvider`, so `useToolbarActiveEditor()` returns the editor that owns the current selection (root editor, or a nested composer like an inline-image caption). For built-in insert items the toolbar suppresses the Insert dropdown when the active editor isn't the root, so an item dispatched against the active editor in that scope is harmless.

#### 7. Per-field editor override (wrapper component pattern)

Schema-side `editorConfig` can't carry extension references (they'd break tsx-loaded seeds). For per-field extension differences, register a wrapper component via `FieldAdminConfig.editor`. The wrapper builds its own `lexicalEditor((c) => ...)` once and forwards every render.

```tsx
// apps/webapp/byline/fields/lexical-richtext-ai.tsx
import { AiLexicalExtension } from '@byline/ai/plugins/lexical'
import type { FieldAdminConfig } from '@byline/core'
import { lexicalEditor } from '@byline/richtext-lexical'

export const LexicalRichTextAi = lexicalEditor((c) => {
  c.extensions.add(AiLexicalExtension)
  return c
})

export function aiRichTextAdmin(): FieldAdminConfig {
  return { editor: LexicalRichTextAi }
}
```

Drop it into one collection's admin config:

```ts
// apps/webapp/byline/collections/news/admin.tsx
fields: {
  content: aiRichTextAdmin(),
}
```

Or set it site-wide in `admin.config.ts`:

```ts
fields: {
  richText: { editor: LexicalRichTextAi },
}
```

The same pattern works to *narrow* the extension set per-field — define `lexicalRichTextCompactAdmin()` that calls `lexicalEditor((c) => c.extensions.remove(TableExtension)...)` and attach it via `FieldAdminConfig.editor`.

#### 8. Schema-side settings preset (`lexicalRichTextCompact`)

For per-field *settings* (not extensions) the schema can carry an `editorConfig`. `lexicalRichTextCompact` is the worked example — it lives in `apps/webapp/byline/fields/lexical-richtext-compact.ts` and bakes a slimmed toolbar configuration into the `RichTextField`:

```ts
// In a collection schema (loaded by tsx-seeds)
import { lexicalRichTextCompact } from '../../fields/lexical-richtext-compact.js'

fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),

  // Compact + per-field placeholder
  lexicalRichTextCompact({
    name: 'summary',
    label: 'Summary',
    configure: (c) => {
      c.settings.placeholderText = 'One-sentence summary…'
      return c
    },
  }),
]
```

The factory imports `defaultEditorConfig` from `@byline/richtext-lexical/server` (data-only, no React) so schemas using it remain tsx-loadable. To narrow the *extension* set for the same field, pair with a `FieldAdminConfig.editor` wrapper as in recipe 7.

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

### Why the core contract stays opaque

The `unknown` typing on `RichTextField.editorConfig` is deliberate. The shape of an editor's configuration is highly editor-specific — Lexical's plugin model, TipTap's extension model, and ProseMirror's schema model do not naturally share a feature graph. A shared shape across adapters would be awkward for all three. Each editor adapter owns its own config shape and its own cast at its own boundary; the core contract stays out of the way.

A future shared feature-graph contract (Phase 4 below) could either replace the opaque slot or sit alongside it for editor-specific extras. Until two editor packages exist with a genuinely compatible feature surface, the opaque slot is the correct shape.

## Inline images and document links — embed and populate

The Lexical plugins for **internal links** and **inline images** are the editor's two relation-bearing node types — the first non-form consumers of Byline's `DocumentRelation` envelope. This section is the present-state reference for how those relations are stored, embedded at write time, and (optionally) refreshed at read time by the framework's richtext populate primitive.

### Two strategies, paired per field

| Phase | What it does | Field flag | Default |
|---|---|---|---|
| **Embed** | At pick / save time, the modal copies a small projection of the picked target's fields into the persisted Lexical JSON. | `embedRelationsOnSave` | `true` |
| **Populate** | At read time, the framework walks the document's rich-text values and asks the registered server adapter to refresh embedded data against the source. | `populateRelationsOnRead` | `!embedRelationsOnSave` |

Four meaningful states:

| `embedRelationsOnSave` | `populateRelationsOnRead` (effective) | Behaviour |
|---|---|---|
| `true` (default) | `false` (default-derived) | **Snapshot.** Embed at write, render embedded data. Cheapest reads, accept staleness. |
| `false` | `true` (default-derived) | **Storage-thin.** Persist relation primary keys only; populate on every read. Always fresh, highest read cost. |
| `true` (explicit) | `true` (explicit) | **Belt-and-braces.** Embed at write *and* refresh on read. Snapshot is the fallback if populate is ever skipped. |
| `false` | `false` | **Invalid.** `initBylineCore()` throws — the field would be unrenderable. |

`initBylineCore()` also throws when any field has effective `populateRelationsOnRead === true` but no server adapter is registered on `ServerConfig.fields.richText.populate`. Fail-fast at boot — the alternative is a silent broken renderer at request time.

### What gets embedded at picker time

When the user picks a target inside the link or inline-image modal, the modal's `onSubmit` handler copies a small projection directly into the persisted Lexical JSON:

- **Internal link** — `{ title, path }`. `title` comes from the target collection's `useAsTitle` field; `path` is top-level metadata on every document. Together these are everything a public renderer needs to build `<a href={path}>{title}</a>`.
- **Inline image** — `{ title, altText, image, sizes }`. `image` is the source media's `StoredFileValue`; `sizes` is `deriveImageSizes(image.variants)` flattened into a renderer-friendly `{ name, url, width, height, format }[]`. Top-level `src` / `width` / `height` / `altText` are also persisted on the inline-image node — Lexical needs them to render in the admin editor, and they remain a usable fallback when populate hasn't run.

Source-of-truth code:

| Step | Location |
|---|---|
| Link modal embed | `packages/richtext-lexical/src/field/extensions/link/link-modal.tsx` (`handlePickerSelect`, `handleSave`) |
| Inline-image modal embed | `packages/richtext-lexical/src/field/extensions/inline-image/inline-image-modal.tsx` (`handlePickerSelect`, `handleSave`) |
| Variant flattening | `packages/richtext-lexical/src/field/extensions/inline-image/utils.ts` (`deriveImageSizes`, `getPreferredSize`) |
| Shared envelope shape | `packages/richtext-lexical/src/field/nodes/document-relation.ts` (`DocumentRelation`) |

### Persisted shapes

Two slightly different on-disk layouts, same envelope:

```ts
// Link node — relation envelope nested under `attributes`.
// (packages/richtext-lexical/src/field/extensions/link/types.ts)
export type SerializedLinkNode = Spread<{ attributes: LinkAttributes }, SerializedElementNode>

export type LinkAttributes =
  | {
      linkType: 'custom'
      url?: string
      newTab?: boolean
      rel?: null | string
    }
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
// (packages/richtext-lexical/src/field/extensions/inline-image/node-types.ts)
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

The two layouts differ for historical / Lexical-mechanics reasons (the link node extends `ElementNode` and wraps its custom attrs in `attributes`; the inline-image node spreads them flat). Both carry the same `DocumentRelation` shape — the visitor abstraction in `lexical-populate-shared.ts` papers over the difference.

`document` is **advisory** in either layout. Renderers must tolerate it being absent — that is what happens when `embedRelationsOnSave: false` is set and populate hasn't yet refreshed the value.

### Server-side populate — registration and runtime

Picker-time embed alone is correct for the snapshot default. To get read-time freshness — required for `embedRelationsOnSave: false` and useful for belt-and-braces collections — register the Lexical adapter's server entry point on `ServerConfig`:

```ts
// apps/webapp/byline/server.config.ts
import { initBylineCore } from '@byline/core'
import { lexicalEditorServer } from '@byline/richtext-lexical/server'
import { getAdminBylineClient } from '@byline/host-tanstack-start/integrations/byline-client'

await initBylineCore({
  // …db, collections, storage, sessionProvider, adminStore, …
  fields: {
    richText: { populate: lexicalEditorServer({ getClient: getAdminBylineClient }) },
  },
})
```

That's the entire opt-in. Every rich-text field across every collection populates according to its `populateRelationsOnRead` flag — including rich-text fields nested inside `group` / `array` / `blocks` structures.

Inside the read pipeline, the new phase slots between relation populate and user-land `afterRead`:

```
findDocuments (DB) → reconstruct → populateDocuments → populateRichTextFields → applyAfterRead
```

For each document — both source documents from the top-level read and materialised relation targets reached during populate — the framework walks the field tree, yields every rich-text leaf, gates each leaf by its effective `populateRelationsOnRead`, and calls the registered populate function. The function mutates the value in place; the framework reads the mutated value back when shaping the response.

The `RichTextPopulateContext` passed to the adapter:

```ts
// packages/core/src/@types/field-types.ts
export interface RichTextPopulateContext {
  value: unknown                  // raw editor JSON, possibly stringified
  fieldPath: string               // 'body', 'content.0.caption', 'meta.summary', …
  collectionPath: string
  readContext: ReadContext        // shared with relation populate / afterRead
}
```

`readContext` is the same request-scoped context the relation populate primitive uses. Adapters that perform their own reads must thread it through (`client.collection(...).find({ _readContext: readContext })`) — visited-set / read-budget / `afterReadFired` machinery covers rich-text fan-out and any nested reads automatically.

### What `lexicalEditorServer()` actually does

The factory composes every Lexical plugin's populate visitor into a single `RichTextPopulateFn`. The package ships two visitors today — one per relation-bearing node type:

| Visitor | File | Refreshes |
|---|---|---|
| `inlineImageVisitor` | `packages/richtext-lexical/src/field/extensions/inline-image/populate.ts` | `node.document` ← `{ title, altText, image, sizes }` |
| `linkVisitor` | `packages/richtext-lexical/src/field/extensions/link/populate.ts` | `attributes.document` ← `{ title, path }` (only when `linkType: 'internal'`) |

Both visitors are pure / framework-agnostic — no React, no DOM, no Lexical runtime. They live next to the plugin's UI code so each plugin's write-time embed and read-time populate stay in lockstep, but only the populate file is reachable from the package's `server` entry.

The shared driver (`runLexicalPopulate` in `lexical-populate-shared.ts`) walks the value's Lexical tree once per call and dispatches across every visitor in a single pass. Pending hydrations are batched per source collection — one `find({ where: { id: { $in: ids } } })` per collection in parallel.

**Tight projection by design.** The visitors mirror exactly what the modals embed at picker time. Anything more ambitious crosses into "render arbitrary linked-doc fields inline" territory, which is a different feature.

**Custom visitors.** The factory accepts a `visitors` override for hosts that want to add a custom node type or temporarily disable a built-in:

```ts
lexicalEditorServer({
  getClient: getAdminBylineClient,
  visitors: [inlineImageVisitor, linkVisitor, myCustomEmbedVisitor],
})
```

### How rich-text-in-blocks works automatically

The framework's leaf walker (`collectRichTextLeaves` in `packages/core/src/services/richtext-populate.ts`) recurses through `group` / `array` / `blocks` to find every richText field declared anywhere in the schema. For blocks specifically, it dispatches each data item by its `_type` to the matching `Block.fields` schema. So a `richTextBlock` instance inside a `content: blocks` field, or a `caption: richText` inside a `photoBlock`, is found and populated without any per-collection wiring or per-block opt-in. Schema is the source of truth for *where* a richText might be; data is the source of truth for *whether one is currently set*.

Yields look like (using the project's example blocks):

| Schema layout | Yielded `fieldPath` |
|---|---|
| Top-level | `body` |
| Inside `group` | `meta.summary` |
| Inside `array` | `faq.0.answer` |
| Inside `blocks` (PhotoBlock caption) | `content.0.caption` |
| Inside `blocks` (RichTextBlock body) | `content.1.richText` |

### Field-level overrides

Both flags are adapter-agnostic — they live on `RichTextField` itself (not inside the opaque `editorConfig`) so any future editor adapter with relation-bearing nodes inherits the same lever:

```ts
fields: [
  { name: 'body', type: 'richText' },                       // snapshot (default)
  { name: 'caption', type: 'richText',
    embedRelationsOnSave: false },                          // storage-thin, requires server adapter
  { name: 'callout', type: 'richText',
    embedRelationsOnSave: true,
    populateRelationsOnRead: true },                        // belt-and-braces
]
```

When `embedRelationsOnSave: false` the link modal persists `{ targetDocumentId, targetCollectionId, targetCollectionPath }` only — `document` is omitted. The inline-image modal does the same; top-level `src` / `width` / `height` / `altText` on the inline-image node still persist (Lexical needs them in admin). Without a registered server adapter `initBylineCore()` throws — see the validation table above.

### Co-existence with relation-field populate

When a `RelationField` on the same collection points at the same target document a richtext node references, both flow through the same `ReadContext`:

- The visited set collapses the two targets into **one** materialisation, not two.
- A→B→A cycles between richtext links and relation fields hit the same cycle marker; the frontend renders `_resolved: false` or `_cycle: true` instead of recursing.

This dedup is automatic as long as the populate function threads `readContext` through to its `client.collection(...).find({ _readContext: readContext })` calls — `lexicalEditorServer()` and the shipped visitors do.

### Why a flat envelope, not a `cached` wrapper

The persisted node attributes flatten the relation envelope directly (`targetDocumentId`, `targetCollectionId`, `targetCollectionPath`, `document?: Record<string, any>`). This matches the `RelationField` value shape verbatim — same information, one fewer layer of nesting than an earlier `{ cached: { ... } }` design. A `cachedAt` ISO marker was considered for staleness windows but dropped; populate overrides the embedded values when wired anyway.

### Code map — strategy

| Concern | Location |
|---|---|
| Picker-time link embed | `packages/richtext-lexical/src/field/extensions/link/link-modal.tsx` |
| Picker-time inline-image embed | `packages/richtext-lexical/src/field/extensions/inline-image/inline-image-modal.tsx` |
| Variant flattening | `packages/richtext-lexical/src/field/extensions/inline-image/utils.ts` |
| `lexicalEditorServer()` factory | `packages/richtext-lexical/src/server.ts` |
| Inline-image populate visitor | `packages/richtext-lexical/src/field/extensions/inline-image/populate.ts` |
| Link populate visitor | `packages/richtext-lexical/src/field/extensions/link/populate.ts` |
| Shared tree walker / batch driver | `packages/richtext-lexical/src/field/lexical-populate-shared.ts` |
| `RichTextField.embedRelationsOnSave` / `populateRelationsOnRead` | `packages/core/src/@types/field-types.ts` |
| `RichTextPopulateFn` / `RichTextPopulateContext` types | `packages/core/src/@types/field-types.ts` |
| `ServerConfig.fields.richText.populate` slot | `packages/core/src/@types/site-config.ts` |
| `EditorSettings.embedRelationsOnSave` runtime flag | `packages/richtext-lexical/src/field/config/types.ts` |
| Field-level → editor-config merge | `packages/richtext-lexical/src/richtext-field.tsx` |
| `populateRichTextFields` service + leaf walker | `packages/core/src/services/richtext-populate.ts` |
| Read-pipeline integration (sources) | `packages/client/src/collection-handle.ts` |
| Read-pipeline integration (populated targets) | `packages/core/src/services/populate.ts` |
| Boot-time validation | `packages/core/src/services/richtext-populate.ts` (`validateRichTextFieldFlags`) |
| Demo wiring | `apps/webapp/byline/server.config.ts` |
| Shared envelope type | `packages/richtext-lexical/src/field/nodes/document-relation.ts` |
| `linksInEditor` collection flag | `packages/core/src/@types/collection-types.ts` |

## Future phases of work

Concrete next steps, roughly ordered by likely sequence. None are committed to a timeline; they're listed so the order of operations is obvious if and when richtext work resumes.

### Phase 2 — A second editor package

The single most useful next step is the **existence of a second editor package** — almost certainly `@byline/richtext-tiptap` or a markdown-focused `@byline/richtext-md`. Until that exists, every adapter-shape question is one-sided. A second package will surface the real questions:

- Is `RichTextEditorProps` enough, or are editors hitting its limits?
- Do they share *anything* in the way they want to expose features?
- What does the per-instance `editorConfig` prop look like across editors, and is the variance painful enough to warrant a normalised shape?
- Where do per-editor stylesheet conventions and theme tokens live?

A second package is also where the test for *whether to grow the contract* becomes empirical rather than speculative.

### Phase 3a — Server-side populate primitive (shipped)

The richtext adapter has a server-side populate function (`ServerConfig.fields.richText.populate`) called by the framework's read pipeline. Embedded relation envelopes (link `{ title, path }`, inline-image `{ title, altText, image, sizes }`) are refreshed against their source documents before user-land `afterRead` fires. Per-field gating via `embedRelationsOnSave` / `populateRelationsOnRead` covers the four meaningful states (snapshot / storage-thin / belt-and-braces / invalid). See [Inline images and document links](#inline-images-and-document-links--embed-and-populate) above for the full reference.

### Phase 3b — User-land editor lifecycle hooks (deferred)

Other CMS frameworks expose per-editor lifecycle hooks — typically `beforeChange`, `afterChange`, `beforeRead`, `serialize`, `deserialize` — that fire as the document moves through the field pipeline. Useful when an editor needs to:

- transform its serialized output before storage (flatten nested marks, strip unsafe nodes),
- rehydrate a stored shape into the editor's runtime state on read,
- run validation that depends on the editor's internal model rather than the surface field value,
- emit derived data (excerpt, plain-text projection, search payload, table-of-contents).

Byline already has analogous hooks one level up — `FieldHooks.beforeValidate` / `beforeChange` on every field, plus collection-level `beforeRead` / `afterRead` / `beforeChange` / `afterChange`. The question is whether a future editor needs its own pipeline distinct from the field-level one. Lexical's serialized state round-trips through the existing `validate` and field hooks without help. If a second editor surfaces a real need — for example a markdown editor that wants to lint output, or a code editor that wants to attach a syntax tree to the stored value — that becomes the moment to design the editor-level pipeline against two concrete shapes rather than one.

The signal to revisit:

- a second editor implementation arrives, *and*
- it cannot achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone, *and*
- the divergence is in the editor itself (serialization, internal model) rather than in surrounding field semantics.

If only the surrounding semantics differ, the right answer is to extend `FieldHooks` rather than introduce an editor-specific pipeline.

Pipeline ordering relative to field and collection hooks is the design question that matters most. The likely answer is *editor hooks fire innermost*, between the editor's render boundary and the field-level pipeline — but that should be confirmed against two concrete implementations.

### Phase 4 — Feature-graph configuration (only if Phase 2/3 demand it)

If two or more editor packages settle into compatible feature shapes — or if a real installation needs to express feature parity across editors — design a shared feature-graph contract. Until that pressure exists, every editor's configuration stays opaque (today's `RichTextField.editorConfig: unknown` plus the per-package config types).

A reasonable bar: do not add feature-graph configuration until at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props.

### Phase 5 — Editor-side server pipeline (search, excerpt, plain text)

Independent of the adapter shape: derived projections from rich text content (search payload, excerpt, plain-text fallback for SSR, structured outline) are useful enough to deserve their own design pass once the search / indexing story takes shape. This is more naturally a concern of `@byline/core/services` than the editor adapter, but the editor adapter is the boundary that knows how to traverse its own document tree, so the two will need to agree on a contract.

This phase is genuinely independent of Phases 2–4 and could ship at any point.

### Phase 6 — Per-collection / per-field editor selection

Today's slot is site-wide. A future phase may want to register an editor per collection or per field — for example, a markdown editor in a documentation collection and a Lexical editor in a marketing collection. This is mechanically easy (extend `CollectionAdminConfig` or `FieldAdminConfig` with an editor slot) but has a real product question behind it: how should installations think about editor variance, and is it a per-field property or a per-collection property?

The existing `FieldComponentSlots.Field` already provides the per-field escape hatch and works today. A more structured per-collection or per-field selection is only worth designing once there's a clear product reason.

### Phase 7 — Extensibility (Lexical adapter)

`@byline/richtext-lexical` exposes a **BYO-extension surface** so installations can add their own Lexical nodes / plugins without forking the package. Built-in features and third-party extensions both register through the same API.

Background. `@byline/richtext-lexical` migrated to the new Lexical [Extensions API](https://lexical.dev/docs/extensions/intro): each built-in feature (admonition, inline-image, layout, link, auto-link, auto-embed, code-highlight, list, table, YouTube, Vimeo, horizontal-rule, …) is a `LexicalExtension` co-located under `packages/richtext-lexical/src/field/extensions/<name>/` with its node class(es), commands, modal, and decorator component in a single directory.

Original plan split this work into four pieces. Status:

1. **Unified extensions list (shipped).** The root extension's `dependencies` array is sourced from `editorConfig.extensions.toArray()`. Site authors manipulate the same list every built-in lives in via the chainable `ExtensionsList` API (`c.extensions.add()` / `.remove()` / `.replace()` / `.configure()`). The flag-based facade in `EditorSettings.options` was dropped for every per-extension toggle (the remaining flags are settings-only — toolbar UI, mode toggles, debug). Full reference and recipes in [Extensibility](#extensibility--extensions-list-settings-and-toolbar-contributions) above.

2. **`BylineToolbarExtension` contract (shipped).** The old `ToolbarExtensionsProvider` React-context registry is gone — replaced by a typed Lexical extension. Contributors (built-in and third-party alike) declare `peerDependencies: [declarePeerDependency(BylineToolbarExtension, { items: [...] })]`. The toolbar plugin reads the merged config via `useExtensionDependency(BylineToolbarExtension)`. Contributions specify `placement: 'toolbar' | 'insert-menu'` and an `order`; built-ins live in the same registry as third parties (no two-tier system).

3. **Floating-UI registry (TODO).** The package's three floating UIs (`FloatingLinkEditorPlugin`, `FloatingTextFormatToolbarPlugin`, `TableActionMenuPlugin`) are still rendered as React plugins inside `Editor.tsx` because each needs the runtime `anchorElem` ref. The cleanest landing is either:
   - **Lexical Output Components** — each floating UI's extension exposes a `Component` via `build()`, and `Editor.tsx` mounts them via `useExtensionComponent(MyFloatingExtension)` at the right position, passing `anchorElem` as a prop. Same positional control as today; third-party floating UIs use the same shape and slot in without touching `Editor.tsx`.
   - **Byline-owned floating-UI registry extension** — a typed extension whose merged config is `{ Component, shouldShow }[]`; `Editor.tsx` iterates and renders them all under the shared anchor. Lower per-extension boilerplate but introduces a Byline-specific concept on top of the Lexical primitive.

   Either route hits the goal: "no Byline application ever needs to fork `Editor.tsx` to add a floating UI." Once that lands, the three built-ins migrate alongside their respective features (`FloatingLinkEditorPlugin` joins `extensions/link/` where it already lives on disk; the others move from `plugins/` to their feature directories), and the `plugins/` directory finally empties out except for the toolbar itself.

   `ToolbarPlugin` stays where it is — it's a *consumer* of `BylineToolbarExtension` (not a contributor) and needs a fixed DOM position above the content-editable, which the decorator slot can't express. If we ever want it under the extension graph, the same Output Component pattern works: have the toolbar's extension `build()` return `{ Component: ToolbarPlugin }` and let `Editor.tsx` mount it via `useExtensionComponent`. Mechanically straightforward; not currently a pain point.

4. **Extensions README (this doc + an in-tree pointer — TODO).** The recipe section above covers the full third-party authoring contract. A short pointer README in `packages/richtext-lexical/src/field/extensions/` deep-linking back here would close the loop for anyone browsing the source tree.

This phase is genuinely Lexical-specific. A second editor package (Phase 2) would have its own extensibility surface shaped by its own plugin model; the Phase 7 design here doesn't generalise to TipTap or ProseMirror.

## Code map — adapter contract

| Concern                                       | Location                                                                  |
|-----------------------------------------------|---------------------------------------------------------------------------|
| `RichTextEditorProps` / `RichTextEditorComponent` contract | `packages/core/src/@types/field-types.ts`                |
| `RichTextPopulateFn` / `RichTextPopulateContext` contract | `packages/core/src/@types/field-types.ts`                  |
| `ClientConfig.fields.richText.editor` slot    | `packages/core/src/@types/site-config.ts`                                 |
| `ServerConfig.fields.richText.populate` slot  | `packages/core/src/@types/site-config.ts`                                 |
| `RichTextField.editorConfig` opaque slot      | `packages/core/src/@types/field-types.ts`                                 |
| `embedRelationsOnSave` / `populateRelationsOnRead` schema flags | `packages/core/src/@types/field-types.ts`               |
| Renderer dispatch                             | `packages/ui/src/fields/field-renderer.tsx` (`case 'richText'`)           |
| Lexical editor package — UI entry             | `packages/richtext-lexical/src/index.ts`                                  |
| Lexical editor package — server entry         | `packages/richtext-lexical/src/server.ts`                                 |
| `lexicalEditor()` registration factory        | `packages/richtext-lexical/src/lexical-editor.tsx`                        |
| `lexicalEditorServer()` registration factory  | `packages/richtext-lexical/src/server.ts`                                 |
| Default editor settings (server-safe)         | `packages/richtext-lexical/src/field/config/default.ts`                   |
| Default extensions list (client-only)         | `packages/richtext-lexical/src/field/config/default-extensions.ts`        |
| `ExtensionsList` chainable wrapper            | `packages/richtext-lexical/src/field/config/extensions-list.ts`           |
| `EditorConfig` / `EditorSettings` types       | `packages/richtext-lexical/src/field/config/types.ts`                     |
| `BylineToolbarExtension` + `selectToolbarItems` | `packages/richtext-lexical/src/field/extensions/byline-toolbar/`        |
| `ToolbarActiveEditorProvider` / `useToolbarActiveEditor` hook | `packages/richtext-lexical/src/field/plugins/toolbar-plugin/toolbar-active-editor.tsx` |
| Toolbar consumer (reads contributed items)    | `packages/richtext-lexical/src/field/plugins/toolbar-plugin/index.tsx`    |
| Editor-context composition (root extension)   | `packages/richtext-lexical/src/field/editor-context.tsx`                  |
| Byline `TableExtension` wrapper               | `packages/richtext-lexical/src/field/extensions/table/`                   |
| Byline `HorizontalRuleExtension` wrapper      | `packages/richtext-lexical/src/field/extensions/horizontal-rule/`         |
| Link extension (UI + extension)               | `packages/richtext-lexical/src/field/extensions/link/`                    |
| Link extension (populate visitor)             | `packages/richtext-lexical/src/field/extensions/link/populate.ts`         |
| Inline-image extension (UI + extension)       | `packages/richtext-lexical/src/field/extensions/inline-image/`            |
| Inline-image extension (populate visitor)     | `packages/richtext-lexical/src/field/extensions/inline-image/populate.ts` |
| Admonition extension                          | `packages/richtext-lexical/src/field/extensions/admonition/`              |
| Layout extension                              | `packages/richtext-lexical/src/field/extensions/layout/`                  |
| Auto-embed (YouTube/Vimeo) extension          | `packages/richtext-lexical/src/field/extensions/auto-embed/`              |
| Code-highlight extension                      | `packages/richtext-lexical/src/field/extensions/code-highlight/`          |
| AI plugin Lexical extension (worked third-party example) | `packages/ai/src/plugins/lexical/extension.tsx`                |
| Per-field component override                  | `FieldComponentSlots.Field` in `packages/core/src/@types/field-types.ts`  |
| Worked compact custom field (settings only)   | `apps/webapp/byline/fields/lexical-richtext-compact.ts`                   |
| Worked per-field AI editor (`aiRichTextAdmin`) | `apps/webapp/byline/fields/lexical-richtext-ai.tsx`                      |
| Reference registration (client)               | `apps/webapp/byline/admin.config.ts`                                      |
| Reference registration (server)               | `apps/webapp/byline/server.config.ts`                                     |
