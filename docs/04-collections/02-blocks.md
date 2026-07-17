---
title: "Blocks"
path: "blocks"
summary: "Block architecture: defineBlock, the per-block schema/admin split (defineBlockAdmin), the dedicated code field, how blocks participate in type generation, and the FORRU legacy-block migration mapping."
---

# Blocks

> **Status: implementation plan (target 4.2).** This document is currently the
> agreed strategy and phased plan for the blocks work. It is updated as each
> phase lands and will be rewritten as a present-state reference when the 4.2
> release ships (at which point the `docs/04-collections/` folder is renumbered
> and this file takes its permanent place as `02-blocks.md`).

Companions:
- [Fields API](./01-fields.md) — field types, the schema-vs-admin split, conditional visibility, virtual fields.
- [Rich Text](./06-rich-text.md) — the Lexical adapter and per-field editor overrides.
- [Relationships](./02-relationships.md) — relation fields and populate (block fields participate identically).

---

## 1. Present-state architecture (4.1)

A block is a reusable, typed unit of structured content that editors compose
inside a `type: 'blocks'` field. Blocks are **schema-only** objects today:

```ts
// apps/webapp/byline/blocks/photo-block.ts (React-free, tsx-loadable)
export const PhotoBlock = defineBlock({
  blockType: 'photoBlock',
  label: 'Photo Block',
  fields: [ /* ordinary Field[] — text, select, relation, richText, … */ ],
})
```

Key machinery:

| Concern | Where |
|---|---|
| `Block` / `BlocksField` interfaces | `packages/core/src/@types/field-types.ts` (~430) |
| `defineBlock`, `BlockFieldData`, `BlockData`, `BlocksUnion` | `packages/core/src/@types/collection-types.ts` (~1394) |
| Storage | flat EAV rows; item identity (`_id`, `_type`) in `store_meta` (UUIDv7) |
| Admin rendering | `packages/admin/src/fields/blocks/blocks-field.tsx` — each block instance renders through a synthesized `GroupField` → `FieldRenderer` per child |
| Type generation | `packages/core/src/codegen/index.ts` — structural dedup of block contracts across collections; emits `<X>BlockData` (+ `AllLocales`) discriminated on `_type`, inside `declare module '@byline/generated-types'` |
| Frontend registry | `apps/webapp/src/ui/byline/render-blocks.tsx` — exhaustive `switch (block._type)` with a `never` guard |

What already works for block child fields (no new machinery needed):
- **Conditional visibility** — `BaseField.condition(data, siblingData)` is evaluated by `useFieldCondition` in `field-renderer.tsx`, which block children reach through `GroupField`.
- **Virtual fields** — participate in the save, never persisted.
- **Field-level hooks and validation** — `Block.hooks` / per-field `hooks`.
- **Type generation** — blocks are fully covered; the same block used in several collections emits one deduped contract.

The two gaps this plan closes:

1. **No admin-side counterpart to `defineAdmin()`.** A richText field inside a
   block can only inherit the *global* `fields.richText.editor` registration —
   no per-block-field `editor` or `components` overrides.
2. **No dedicated `code` field type.**

---

## 2. Phase A — per-block schema/admin split (`defineBlockAdmin`)

*Status: implemented (unreleased).*

Blocks keep the collections' contract: **schema files stay React-free**; admin
config lives separately and may carry React.

### API (`@byline/core`)

```ts
// packages/core/src/@types/admin-types.ts
export interface BlockAdminConfig {
  blockType: string
  /** Per-field rendering overrides, keyed by the block's top-level field names. */
  fields?: Record<string, FieldAdminConfig>
}

export function defineBlockAdmin<B extends Block>(
  block: B,
  config: { fields?: Partial<Record<Extract<keyof BlockFieldData<B>, string>, FieldAdminConfig>> }
): BlockAdminConfig
```

`FieldAdminConfig` is reused unchanged (`components` slots + `editor`
override). v1 addresses **top-level block field names only** — the same
limitation the collection-level `fields{}` map has.

### Registration — blockType-keyed registry

```ts
// ClientConfig (packages/core/src/@types/site-config.ts)
blockAdmin?: BlockAdminConfig[]
```

Registered in the app's `admin.config.ts` alongside `admin:`. Rationale for a
registry over per-collection nesting:

- Blocks are cross-collection deduped units — codegen already treats the same
  block in `docs` and `pages` as one contract; a blockType-keyed registry gives
  it one admin identity to match.
- Zero path-threading: `BlocksField` resolves by `item._type` wherever it
  renders (inside tabs, groups, drag-reordered, freshly inserted).
- Per-collection variance escape hatch: define a second block with a different
  `blockType`; a per-collection override layer can be added later without
  breaking this API.

### Threading (`@byline/admin`)

- `group-field.tsx` — new optional prop
  `fieldAdmin?: Record<string, FieldAdminConfig>`; passes
  `components`/`editor` per child into `FieldRenderer`. (This is the
  generalized nested-admin seam; `ArrayField` can adopt the same prop later.)
- `blocks-field.tsx` — resolves `getClientConfig().blockAdmin` into a memoized
  map; passes `fieldAdmin={map.get(item._type)?.fields}` to the synthesized
  `GroupField`.
- `field-renderer.tsx` — unchanged.

> **Why `group-field.tsx`? — the three "group" concepts.** Byline has (1) the
> **structural `group` field** (`type: 'group'` in a schema — shapes stored
> data; rendered by `packages/admin/src/fields/group/group-field.tsx`), (2)
> the **admin layout group primitive** (`groups:` in `CollectionAdminConfig` —
> pure visual clustering of top-level fields; rendered by the presentation
> layer; untouched by this work), and (3) the **synthesized GroupField inside
> `BlocksField`** — blocks have no child-rendering machinery of their own;
> each block instance renders by fabricating a structural-group field object
> (`{ type: 'group', name: blockType, fields: block.fields }`) and handing it
> to the structural widget. That synthesized path is the funnel through which
> every block child reaches `FieldRenderer`, which is why the `fieldAdmin`
> prop lands on the structural `GroupField`. Plain schema `group` fields
> receive no `fieldAdmin` today, so they are unaffected — the prop is simply
> the generalized seam future nested-admin work would reuse.

### Boot validation

`validateBlockAdminConfigs(blockAdmin, collections)` called next to
`validateAdminConfigs` in `defineClientConfig`: walks all collections' fields
collecting `blockType → Block`; fails on unknown blockType, duplicate entries,
or `fields` keys that aren't top-level fields of that block.

### Explicitly unchanged

`defineBlock` / `BlockData` / serialization / codegen / storage / zod — admin
config never enters the schema graph.

---

## 3. Phase B — dedicated `code` field type

*Status: implemented (unreleased).*

A new value field riding the existing `store_text` table — **no migration**.
The admin widget is **CodeMirror 6** (not Monaco): lighter, MIT, fully
bundleable (no CDN runtime), lazy-loaded so it never lands in the main admin
chunk.

### Schema type

```ts
{
  name: 'code',
  type: 'code',
  language?: string,        // static default highlight language
  languageField?: string,   // name of a SIBLING field (e.g. a select) whose
                            // value drives highlighting at runtime
  validation?: { minLength?: number; maxLength?: number; rules?: ValidationRule[] },
}
```

`languageField` models the classic "language select + code editor" block shape
directly (and unlike Payload's code field, the sibling select actually drives
the editor). Min/max length are **enforced** by the zod builder.

### Seams

Core: `CodeField` + `ValueField` union (`field-types.ts`); `field-data-types.ts`
(`code: string`); `field-store-map.ts` (`{ storeType: 'text', valueColumn: 'value' }`);
zod builder case; codegen `describeField` + `fieldType` (→ `string`, no
FORMAT_VERSION bump); `collection-fingerprint.ts`; `validate-collections.ts`
value-field list. Deliberately **excluded** from `TEXT_LEAF_TYPES` in
`build-search-document.ts` (code bodies are full-text noise). Contract test:
`field-store-map.test.node.ts` VALUE_FIELD_TYPES; codegen fixtures
(`all-fields.*`) gain a code field top-level + inside a block.

db-postgres: `storage-flatten.ts` text group gains `case 'code'`; restore keys
off `field-store-map` (no change); round-trip fixture extended.

Admin (`packages/admin/src/fields/code/`):
- `code-field.tsx` — clones the `text-area-field.tsx` plumbing (slots, errors,
  locale badge); resolves effective language from `languageField` sibling value
  else static `language`.
- `code-editor.tsx` — owns all CodeMirror imports; loaded via `React.lazy` +
  `Suspense` (plain read-only textarea fallback). Per-language grammars
  lazy-load through a loader map + CodeMirror `Compartment`.
- Theme: one `EditorView.theme` + `HighlightStyle` built on CSS custom
  properties (`--byline-code-*`) with light/`.dark` values in CSS — follows
  admin theme flips with zero JS.
- Deps (regular deps of `@byline/admin`): `@codemirror/{state,view,language,commands}`
  + lang packs (javascript, json, html, css, markdown, python, sql, yaml).

---

## 4. Phase C — reference blocks (bylinecms.dev)

*Status: implemented (unreleased). Remaining: browser-preview verification of the
lazy CodeMirror chunk, theme flip, and the plain-vs-AI editor contrast — the
blocks themselves are exercised and persisting correctly via manual admin use.*

Two new blocks in `apps/webapp/byline/blocks/`, registered in the `docs` and
`pages` collections, wired end-to-end (typegen → frontend registry → tests →
seeds):

- **CodeBlock** — exercises the code field: `language` select (default
  `typescript`) + `code` field with `languageField: 'language'` + optional
  `caption`. Frontend renders a server-renderable `<pre><code>` (consumers may
  wire shiki/prism).
- **QuoteBlock** — exercises the block admin split: `highlightQuote` (text,
  localized, optional), `quoteText` (richText, localized), `source` (text,
  non-localized, optional). `quote-block.admin.ts` registers a plain non-AI
  editor on `quoteText` via `defineBlockAdmin` while the site-wide editor stays
  `LexicalRichTextAi` — the visible proof of Phase A. Deliberately the FORRU
  quote shape minus the image, so the migration guide can point at it.

---

## 5. Phase D — FORRU legacy-block migration mapping

*Status: **done** — the full, decision-complete migration guide lives in the
FORRU project itself: `beta.forru.org/MIGRATION-PLAN.md` §7 (BLOCKS) and §8
(FRONT END). It supersedes the sketch below (kept here as the framework-side
summary) and adds: the relation-vs-inline-upload decision rule, the
block-factory pattern for collection-relative storage directories (pairs with
the queued `upload.directory` option — recommended for 4.2), and the position
that video/audio remain `file`-field helpers rather than new primitives.
Executed in beta.forru.org against published `@byline/* ^4.2.0`.*

### Global caveats

**Polymorphic relation gap.** Byline's `RelationField` has a single
`targetCollection`; Payload's `relationship` accepts many. Affected:
`related-content` (10 targets), `banner` links. Options:

- **(a)** `targetType` select + N conditional single-target relation fields
  (`condition` works inside blocks today) — *recommended for banner* (2–3
  realistic targets).
- **(b)** Audit production content and restrict to the collections actually
  linked — *recommended for related-content*.
- **(c)** Defer pending a core polymorphic-relation feature (roadmap candidate,
  out of 4.2 scope).

**Media modeling parameterized.** Relation targets below are placeholders —
`<MEDIA>`, `<VIDEOS>`, `<ATTACHMENTS>`, `<GALLERIES>` — decided per block at
migration time (single `media` collection vs split collections).

### Per-block mapping

| Legacy block | Byline sketch | Notes |
|---|---|---|
| **richtext** | — | Already in beta. |
| **photo** | Delta on beta's `photoBlock`: add `position` select, `useSourcePhotoCaption` checkbox, `caption` richText with `condition: (_d, s) => !s?.useSourcePhotoCaption` | Conditions inside blocks work today. |
| **code** | `language` select + `code` field (`languageField: 'language'`) | Beta's existing code serializer UI (`src/ui/byline/components/code/`) renders it. Legacy never wired the select to the editor; byline does. |
| **quote** | Reference QuoteBlock + optional `image` relation → `<MEDIA>` | |
| **faq** | `faq` array of group `{ question: text (localized), answer: richText (localized) }` | |
| **banner** | `tagline` text (localized), `bannerText` richText (localized), `position` select, `links` array (min 1 / max 2) of group `{ type select, conditional relation(s) per caveat (a), url text (condition type === 'custom'), label, appearance select }` | Polymorphic workaround (a). |
| **gallery** | `format` select, `thumbnailSize` select (`condition: (_d, s) => s?.format === 'lightbox'`), `showDescription` checkbox, relation → `<GALLERIES>` | |
| **attachments** | `format` select (widgets/links), `headingText` text (localized, default "Downloads"), `attachments` array of relation → `<ATTACHMENTS>` | |
| **video** | `position` select, `video` relation → `<VIDEOS>`, optional `videoMobile` relation, `useSourceVideoCaption` checkbox, conditional `caption` richText | |
| **video-embed** | `type` select (youtube/vimeo), `position` select, `url` text, `caption` richText | Payload's admin-preview `ui` field maps to `defineBlockAdmin(…, { fields: { url: { components: { afterField: VideoEmbedPreview } } } })` — optional / phase 2. |
| **timeline** | `title` text (localized), `items` array of group `{ title, period, description richText }`, all localized | |
| **plaintext** | richText with a restricted per-block editor via `defineBlockAdmin` (minimal extension set) — the idiomatic 4.2 answer; `textArea` is the low-tech alternative | Used only by `parts` in legacy. |
| **recent-publications** | `show` integer, `defaultValue: 3` | Trivial. |
| **markdown** | **Skip** | Never rendered in legacy. If ever needed: `code` field with `language: 'markdown'`. |
| **bios**, **slider** | **Skip** (unused in legacy) | Sketches on request — "only if needed". |

### Per-block mechanics checklist (beta.forru.org)

1. Schema file in `byline/blocks/<name>-block.ts` (React-free).
2. Register in the target collections' `blocks:` arrays.
3. `pnpm byline:generate` — regenerate `byline/generated/collection-types.ts`.
4. Add the `case '<blockType>'` to `src/ui/byline/render-blocks.tsx` (the
   `never` guard forces it) + frontend component.
5. Seed / content-migration entry as applicable.
6. If the block has admin overrides: `<name>-block.admin.ts` +
   `blockAdmin: […]` in the admin config.

---

## 6. Phase E — doc finalization

*Status: planned (last).* Rewrite this document as a present-state reference;
renumber `docs/04-collections/` (relationships→03, document-trees→04,
document-paths→05, file-media-uploads→06, rich-text→07,
collection-versioning→08) and update all cross-references (~65 refs across ~40
files including CLAUDE.md, README, JSDoc comments, and CLI templates).
