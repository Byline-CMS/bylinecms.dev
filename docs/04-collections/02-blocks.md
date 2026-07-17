---
title: "Blocks"
path: "blocks"
summary: "Block architecture: defineBlock, the per-block schema/admin split (defineBlockAdmin), tailoring editors per block, blocks in type generation and storage, inline uploads with upload.location, and the reference blocks."
---

# Blocks

Companions:
- [Fields API](./01-fields.md) — field types (including `code`), the schema-vs-admin split, conditional visibility, virtual fields.
- [Rich Text](./07-rich-text.md) — the Lexical adapter, `lexicalEditor()`, and per-field editor overrides.
- [Relationships](./03-relationships.md) — relation fields and populate (block fields participate identically).
- [File / Media Uploads](./06-file-media-uploads.md) — inline upload fields and `upload.location`.

## Overview

A block is a reusable, typed unit of structured content that editors compose
inside a `type: 'blocks'` field. Like collections, blocks live on two sides of
the schema/admin split:

```ts
// apps/webapp/byline/blocks/quote-block.ts (schema — React-free, tsx-loadable)
export const QuoteBlock = defineBlock({
  blockType: 'quoteBlock',
  label: 'Quote Block',
  fields: [ /* ordinary Field[] — text, select, relation, richText, code, … */ ],
})

// apps/webapp/byline/blocks/quote-block.admin.ts (admin — may carry React)
export const QuoteBlockAdmin = defineBlockAdmin(QuoteBlock, {
  fields: { quoteText: { editor: PlainLexicalEditor } },
})
```

A collection consumes blocks through a normal field:

```ts
{ name: 'content', type: 'blocks', optional: true, blocks: [RichTextBlock, PhotoBlock, CodeBlock, QuoteBlock] }
```

Stored data is a flat array of `{ _id, _type, ...fields }` items — `_type`
discriminates the union, `_id` (UUIDv7, held in `store_meta`) is the stable
item identity that drag-reordering and the patch system key on.

Everything that works for collection fields works for block child fields:
conditional visibility (`condition(data, siblingData)`), virtual fields,
field-level hooks and validation, localization per child field, relations
(with populate), and inline upload fields.

## Key machinery

| Concern | Where |
|---|---|
| `Block` / `BlocksField` interfaces | `packages/core/src/@types/field-types.ts` |
| `defineBlock`, `BlockFieldData`, `BlockData`, `BlocksUnion` | `packages/core/src/@types/collection-types.ts` |
| `BlockAdminConfig`, `defineBlockAdmin` | `packages/core/src/@types/admin-types.ts` |
| Registration | `ClientConfig.blockAdmin` (`packages/core/src/@types/site-config.ts`) |
| Boot validation | `validateBlockAdminConfigs` in `packages/core/src/config/validate-admin-configs.ts` |
| Admin rendering | `packages/admin/src/fields/blocks/blocks-field.tsx` — each block instance renders through a synthesized `GroupField` → `FieldRenderer` per child |
| Storage | flat EAV rows; item identity (`_id`, `_type`) in `store_meta` (UUIDv7) |
| Type generation | `packages/core/src/codegen/index.ts` — structural dedup of block contracts across collections; emits `<X>BlockData` (+ `AllLocales`) discriminated on `_type`, inside `declare module '@byline/generated-types'` |
| Frontend registry | `apps/webapp/src/ui/byline/render-blocks.tsx` — exhaustive `switch (block._type)` with a `never` guard |
| Reference blocks | `apps/webapp/byline/blocks/{richtext,photo,code,quote,faq}-block.ts` (+ `.admin.ts` where tailored; `faq-block.admin.ts` is the dotted schema-path reference) |

---

## Per-block admin config (`defineBlockAdmin`)

Blocks keep the collections' contract: **schema files stay React-free**; admin
config lives separately and may carry React (editor components, slot
components).

### API (`@byline/core`)

```ts
export interface BlockAdminConfig {
  blockType: string
  /** Per-field overrides, keyed by index-free schema paths relative to the block root. */
  fields?: Record<string, FieldAdminConfig>
}

export function defineBlockAdmin<B extends Block>(
  block: B,
  config: {
    fields?: Partial<
      Record<Extract<keyof BlockFieldData<B>, string> | (string & {}), FieldAdminConfig>
    >
  }
): BlockAdminConfig
```

`FieldAdminConfig` is reused unchanged (`components` slots + `editor`
override). Keys are **schema paths** relative to the block root: a top-level
field name (`quoteText`, which the type parameter autocompletes) or a dotted,
index-free path through the block's `group` / `array` structure
(`faq.answer` — see [Schema paths vs instance paths](./01-fields.md#schema-paths-vs-instance-paths)).
A schema path addresses a field *declaration*, so one entry applies to that
field in every array item. Paths never traverse a nested `blocks` field — an
inner block resolves its own registry entry wherever it renders. The
collection-level `fields{}` map speaks the same notation for non-block
nesting.

### Registration — blockType-keyed registry

```ts
// byline/admin.config.ts
blockAdmin: [QuoteBlockAdmin, PhotoBlockAdmin],
```

Registered site-wide on `ClientConfig.blockAdmin` and applied wherever the
block renders — any collection, any nesting. Rationale for a registry over
per-collection nesting:

- Blocks are cross-collection deduped units — codegen already treats the same
  block in `docs` and `pages` as one contract; a blockType-keyed registry gives
  it one admin identity to match.
- Zero path-threading: `BlocksField` resolves by `item._type` wherever it
  renders (inside tabs, groups, drag-reordered, freshly inserted).
- Per-collection variance escape hatch: define a second block with a different
  `blockType`; a per-collection override layer can be added later without
  breaking this API.

Boot validation (`validateBlockAdminConfigs`, run by `defineClientConfig`)
walks all collections' fields collecting `blockType → Block` declaration
sites and fails on unknown blockTypes, duplicate entries, or `fields` keys
that don't resolve as schema paths within the block (an index-carrying key,
a path through a value field or a nested `blocks` field, or a leaf that
isn't declared — checked against the union of declaration sites when the
same `blockType` appears in several collections).

### How the override reaches the widget

`BlocksField` has no child-rendering machinery of its own — each block
instance renders by synthesizing a structural-group field object
(`{ type: 'group', name: blockType, fields: block.fields }`) and handing it to
`GroupField`, which loops the children through `FieldRenderer`. The admin
config rides that hand-off: `BlocksField` resolves the registry by
`item._type` and passes the entry's `fields` map as `GroupField`'s
`fieldAdmin` prop. Each structural widget then consumes the map one level at
a time: a child's exact-name entry becomes its `components`/`editor` props,
and its descendant entries are re-keyed with the prefix stripped
(`sliceFieldAdmin`, `packages/admin/src/fields/field-admin.ts`) and threaded
on through `FieldRenderer` into the child's own `GroupField`/`ArrayField`.
That is how a dotted key like `faq.answer` walks the widget tree to the
right leaf, where the existing resolution
(`editor ?? getClientConfig().fields.richText.editor`) lets the per-block
override beat the site-wide default.

> **The three "group" concepts.** Byline has (1) the **structural `group`
> field** (`type: 'group'` in a schema — shapes stored data; rendered by
> `packages/admin/src/fields/group/group-field.tsx`), (2) the **admin layout
> group primitive** (`groups:` in `CollectionAdminConfig` — pure visual
> clustering of top-level fields; rendered by the presentation layer), and
> (3) the **synthesized GroupField inside `BlocksField`** described above.
> The `fieldAdmin` prop lands on the structural widget because blocks render
> *through* it; plain schema `group` and `array` fields receive the same prop
> from the collection admin config's `fields{}` map (sliced per level by
> `FormRenderer` → `FieldRenderer`), so dotted keys work identically inside
> and outside blocks.

### What block admin config never touches

`defineBlock` / `BlockData` / serialization / codegen / storage / zod — admin
config never enters the schema graph. Adding or changing a block's admin
entry changes no generated type and no stored byte.

---

## Tailoring editors per block

The worked pattern for giving one block's richText field its own editor
(reference implementations: `apps/webapp/byline/blocks/photo-block{.ts,.admin.ts}`
and `quote-block{.ts,.admin.ts}`):

- **Settings half (schema)** — build an `EditorConfig` from
  `structuredClone(defaultEditorConfig)` (imported from
  `@byline/richtext-lexical/server`, the data-only subpath) and bake it into
  the block field's `editorConfig`. JSON-safe: toolbar toggles, placeholder,
  markdown behavior.
- **Extension half (admin)** — build the editor component inline with
  `lexicalEditor((c) => …removals…)` from `@byline/richtext-lexical/config`
  in the block's `.admin.ts`, registered via `defineBlockAdmin`. React-safe:
  which node extensions (Insert-menu items, links, floating UI) survive.

The two reference blocks deliberately differ: PhotoBlock's caption keeps
`Link`/`AutoLink` (photo credits carry links); QuoteBlock's quotation removes
them. Both replace the site-wide AI-enabled editor for that one field while
every other richText field keeps it.

FAQBlock (`faq-block{.ts,.admin.ts}`) extends the same pattern to a **nested**
field: its answer editor's settings half is baked into the `answer` field
inside the block's `faq` array, and the extension half is registered with the
dotted schema-path key `faq.answer` — one entry that applies to the answer
field of every FAQ item.

---

## Blocks and type generation

Blocks are fully covered by `emitCollectionTypes` (see the generate script in
`apps/webapp/byline/scripts/generate-types.ts`):

- Block contracts are **structurally deduped across collections** — the same
  block object (or two blocks with identical `blockType` + field signature)
  emits one exported alias (`QuoteBlockData` + `QuoteBlockDataAllLocales`).
- A `blocks` field renders as `Array<A | B | …>` discriminated on `_type`,
  which is what makes the frontend registry's exhaustive `switch` + `never`
  guard work: register a block in any schema, regenerate, and the typecheck
  fails until a renderer exists.
- Admin config, upload config, and `editorConfig` are **not** part of the
  structural contract — per-collection block-factory instances (see below)
  share one generated type as long as `blockType` and field shapes match.

---

## Blocks with inline uploads (`upload.location`)

Blocks may carry their own `image`/`file` fields instead of relating to a
media collection — right when the asset is document-owned (uploaded in place,
never reused). Because the same block is typically consumed by several
collections, write upload-carrying blocks as **factories** so each collection
instantiates its own storage scope:

```ts
export const attachmentsBlock = (opts: { location: string }) =>
  defineBlock({
    blockType: 'attachmentsBlock',
    fields: [
      {
        name: 'attachments', type: 'array',
        fields: [{
          name: 'file', type: 'file',
          upload: { mimeTypes: ['application/pdf'], location: opts.location },
        }],
      },
    ],
  })

// news schema: attachmentsBlock({ location: 'news/attachments' })
// pages schema: attachmentsBlock({ location: 'pages/attachments' })
```

`upload.location` is boot-validated plain data — see
[File / Media Uploads → Scope a field's storage location](./06-file-media-uploads.md).
Factory instances dedupe to one generated block type (upload config is not
part of the codegen contract). Keep the field *structure* identical across
instances — structural drift forks the contract.

For library assets (reused, curated, own lifecycle) prefer a relation to a
media collection instead — the reference PhotoBlock relates to `media`.

---

## Code map

| Concern | Location |
|---|---|
| `defineBlock` + block data types | `packages/core/src/@types/collection-types.ts` |
| `defineBlockAdmin` + `BlockAdminConfig` | `packages/core/src/@types/admin-types.ts` |
| `blockAdmin` registration slot | `packages/core/src/@types/site-config.ts` (`ClientConfig`) |
| Boot validation + tests | `packages/core/src/config/validate-admin-configs{.ts,.test.node.ts}` |
| BlocksField (picker, D&D, registry resolution) | `packages/admin/src/fields/blocks/blocks-field.tsx` |
| GroupField `fieldAdmin` threading | `packages/admin/src/fields/group/group-field.tsx` |
| Codegen (dedup, `_type` unions) | `packages/core/src/codegen/index.ts` |
| Reference block schemas | `apps/webapp/byline/blocks/*.ts` |
| Reference block admin configs | `apps/webapp/byline/blocks/*.admin.ts` |
| Reference frontend registry + components | `apps/webapp/src/ui/byline/render-blocks.tsx`, `src/ui/byline/blocks/*` |
