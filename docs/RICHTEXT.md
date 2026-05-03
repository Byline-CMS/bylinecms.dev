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

## Editor configuration — three layers, opaque to core

Editor settings can come from three places. The wrapper in `@byline/richtext-lexical` resolves them in priority order:

1. **`field.editorConfig`** — most specific. The schema author opted in for this field.
2. **`editorConfig` prop** baked in via `lexicalEditor(configure)` at registration.
3. **`defaultEditorConfig`** — package fallback.

`RichTextField.editorConfig` is typed `unknown` in `@byline/core`. The shape is opaque — each editor adapter defines what it accepts. For `@byline/richtext-lexical` this is the package's `EditorConfig`; for a hypothetical TipTap adapter it would be a TipTap extension list. The core contract does not interpret the value; the editor adapter casts at its own boundary.

### Site-wide reduced editor

```ts
// apps/webapp/byline/admin.config.ts
import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.settings.options.tablePlugin = false
        c.settings.options.codeHighlightPlugin = false
        return c
      }),
    },
  },
})
```

`lexicalEditor(configure?)` returns a `RichTextEditorComponent` with editor settings baked in via closure. The `configure` callback receives a `cloneDeep(defaultEditorConfig)` so mutating it is safe and never leaks across registrations. `lexicalEditor()` with no argument is equivalent to registering `RichTextField` directly.

### Per-field compact custom field

Define a custom field factory that bakes an `editorConfig` into the schema:

```ts
// apps/webapp/byline/fields/lexical-richtext-compact.ts

type Options = Partial<Omit<RichTextField, 'type' | 'editorConfig'>> & {
  configure?: (config: EditorConfig) => EditorConfig
}

export function lexicalRichTextCompact(options: Options = {}): RichTextField {
  const { configure, ...rest } = options
  const base = applyCompactPreset(cloneDeep(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base
  return { name: 'richText', label: 'RichText', ...rest, type: 'richText', editorConfig }
}
```

```ts
// In a collection schema
fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),

  // Compact preset, but re-enable lists for this one field:
  lexicalRichTextCompact({
    name: 'summary',
    configure: (c) => { c.settings.options.listPlugin = true; return c },
  }),
]
```

The factory pattern matches the project convention already established for `availableLanguagesField`: `Partial<Omit<TargetField, …computed props…>>` for options, an explicit narrow callback for any computed values, no surprises.

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
| Link modal embed | `packages/richtext-lexical/src/field/plugins/link-plugin/link/link-modal.tsx` (`handlePickerSelect`, `handleSave`) |
| Inline-image modal embed | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/inline-image-modal.tsx` (`handlePickerSelect`, `handleSave`) |
| Variant flattening | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/utils.ts` (`deriveImageSizes`, `getPreferredSize`) |
| Shared envelope shape | `packages/richtext-lexical/src/field/nodes/document-relation.ts` (`DocumentRelation`) |

### Persisted shapes

Two slightly different on-disk layouts, same envelope:

```ts
// Link node — relation envelope nested under `attributes`.
// (packages/richtext-lexical/src/field/nodes/link-nodes/types.ts)
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
// (packages/richtext-lexical/src/field/nodes/inline-image-node/types.ts)
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
| `inlineImageVisitor` | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/populate.ts` | `node.document` ← `{ title, altText, image, sizes }` |
| `linkVisitor` | `packages/richtext-lexical/src/field/plugins/link-plugin/populate.ts` | `attributes.document` ← `{ title, path }` (only when `linkType: 'internal'`) |

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
| Picker-time link embed | `packages/richtext-lexical/src/field/plugins/link-plugin/link/link-modal.tsx` |
| Picker-time inline-image embed | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/inline-image-modal.tsx` |
| Variant flattening | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/utils.ts` |
| `lexicalEditorServer()` factory | `packages/richtext-lexical/src/server.ts` |
| Inline-image populate visitor | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/populate.ts` |
| Link populate visitor | `packages/richtext-lexical/src/field/plugins/link-plugin/populate.ts` |
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
| Default editor config + presets               | `packages/richtext-lexical/src/field/config/`                             |
| Link plugin (UI)                              | `packages/richtext-lexical/src/field/plugins/link-plugin/`                |
| Link plugin (populate visitor)                | `packages/richtext-lexical/src/field/plugins/link-plugin/populate.ts`     |
| Inline image plugin (UI)                      | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/`        |
| Inline image plugin (populate visitor)        | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/populate.ts` |
| Per-field component override                  | `FieldComponentSlots.Field` in `packages/core/src/@types/field-types.ts`  |
| Worked compact custom field                   | `apps/webapp/byline/fields/lexical-richtext-compact.ts`                   |
| Reference registration (client)               | `apps/webapp/byline/admin.config.ts`                                      |
| Reference registration (server)               | `apps/webapp/byline/server.config.ts`                                     |
