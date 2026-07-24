---
title: "Path Grammar"
path: "path-grammar"
summary: "How Byline identifies fields in stored documents, schemas, patches, forms, and upload configuration — the two path notations, when to use each, and their APIs and limits."
---

# Path Grammar

Companions:
- [Document Storage](./01-document-storage.md) — how `field_path` and the `store_meta` path appear in stored rows.
- [Fields](../04-collections/01-fields.md) — which path format each collection option accepts.
- [Collections](../04-collections/index.md) — upload hooks, whose registry keys are declaration paths.
- [Blocks](../04-collections/02-blocks.md) — why field overrides inside blocks use the `blockAdmin` registry rather than a path.

## Overview

Byline addresses individual fields with dotted paths, and you will meet them in configuration keys, validation errors, patches, form state, upload hooks, and stored rows. They all look alike. They are not all the same thing, and passing one where another is expected is the most common way to get a confusing error.

Read this document when you are writing a configuration key that names a nested field, debugging a validation message that points at a path you did not expect, or implementing anything that produces or consumes paths.

### The two notations

Nearly every path in Byline answers one of two questions:

- **Which value in this document do you mean?** That is an **instance path**. It selects array and block items with a bracket selector, and it carries no block type, because the selected item already records its own `_type`.

  ```text
  content[id=block-id].gallery[id=image-id].alt
  ```

- **Which field in this schema do you mean?** That is a **declaration path**. It has no selectors, and it *must* include block types, because two blocks may declare the same field name.

  ```text
  content.photoBlock.gallery.alt
  ```

A third notation is persisted: **storage paths** use dotted positions *and* block types (`content.0.photoBlock.gallery.1.alt`). Strip the positions from a storage path and you have its declaration path — the two are one grammar with two serialisations.

The distinction is load-bearing. An instance path without selectors is still an instance path (`title` is valid), and a declaration path that omits a block type is ambiguous rather than merely terse.

## One field, every notation

Take a single upload-capable field and follow it through the system. The schema:

```text
collection:    pages
blocks field:  content
block type:    photoBlock
array field:   gallery
field:         heroImage
```

That one field is addressed eight different ways, depending on who is asking:

| Context | Path | What it identifies |
|---|---|---|
| Stored `field_path` | `content.0.photoBlock.gallery.1.heroImage` | One stored value, using dotted positions and a block type |
| Upload hook registry | `pages.content.photoBlock.gallery.heroImage` | One upload field declaration, prefixed by collection |
| Collection validation | `content.photoBlock.gallery.heroImage` | One field declaration |
| Collection admin `fields{}` | Not reachable through blocks | Block traversal is rejected — use `blockAdmin` |
| Block admin `fields{}` | `gallery.heroImage` | One declaration, relative to the block root |
| Field patch | `content[id=…].gallery[id=…].heroImage` | One document value |
| Structural patch | `content` or `content[id=…].gallery` | A repeating container |
| Form state | `content[id=…].gallery[id=…].heroImage` | One document value, with positional fallback when needed |

Reading down that column tells you the rule: **anything addressing a schema drops selectors and keeps block types; anything addressing a document keeps selectors and drops block types; storage keeps both.**

Patch paths and form paths share the bracket notation — both `parseInstancePath` and the form path helpers accept `[id=…]` and `[n]`. Structural `array.move` and `array.remove` patches work slightly differently: the patch `path` names the array or blocks field, and a separate `itemId` names the item, which may be a numeric position when stable identity is unavailable.

## Why Byline needs field paths at all

A document can nest groups, arrays, blocks, and relations. Rather than storing it as one opaque JSON value, Byline flattens its values into typed tables such as `store_text`, `store_numeric`, and `store_file`, which keeps them available to relational indexes, constraints, queries, and transactions.

Each row then needs an address so the document can be rebuilt — enough to say "the alt text of the first image in the gallery of the second block on this page". Arrays and blocks also produce `store_meta` rows for item identity. Groups produce no rows of their own, and absent, `null`, and virtual values are not stored at all. [Document Storage](./01-document-storage.md) covers the full mapping.

Paths address values *within* a version. Saving still produces one immutable document version: the admin interface sends patches, the server applies them to the reconstructed document, and the complete result for the edited locale is flattened into a new version while other locales carry forward. Paths do not create separate versions or audit histories for individual fields.

## Instance paths

An instance path identifies a value in one document, selecting array and block items by stable id or by position.

Selectors are only needed inside repeating fields, so all of these are valid instance paths:

```text
title
metadata.caption
content
content[id=block-id].gallery[id=image-id].alt
```

The first two identify values; `content` can be a structural patch target.

**Prefer `[id=…]`.** It continues to identify the same item after a reorder, where `[0]` identifies whichever item happens to be first when the path is evaluated. Stable ids keep form state, hooks, deferred uploads, and patches attached to the item you meant. They do not resolve concurrent saves — the document-version conflict check handles that separately.

### In forms

The admin interface uses instance paths for form state, hooks, conditions, deferred uploads, and patches. For canonical array and block items it emits stable id selectors. New items receive `_id` values in the browser before the first save, and reordering updates both the rendered list and the form store.

A stable form write fails if its id no longer exists. That is deliberate: it stops late asynchronous work from recreating a removed item or writing to a sibling. Removing an item clears its pending uploads, and during upload execution the form is inert so structural edits cannot invalidate the save's upload snapshot.

**Positional fallback.** Form paths retain `[n]` for legacy items and for created defaults with no usable id. An `[id=…]` value must be a non-empty string containing no `.`, `[`, or `]`. Structural edits keep positional form state synchronised immediately, but a position is not stable across deferred work and reorders — so when identity must survive them, use canonical `_id` data.

### In patches

`parsePatchPath` uses `parseInstancePath` but preserves the existing patch segment property `key` rather than `name`. A malformed path produces no segments, so its patch is rejected outright rather than applied against a partial path.

That is syntax validation, not schema validation. Field resolution stays best-effort and searches block variants by child name rather than by the selected item's `_type`. Server-side `field.set` can create an `{ _id }` item when an id is absent, while admin form writes deliberately fail when an id target has disappeared.

A positional patch uses the array order at that point in the patch stream. The optimistic concurrency check rejects a stale `documentVersionId` rather than rebasing it across a reorder saved by another request.

## Declaration paths

A declaration path identifies a field *definition* in a collection schema. It carries no selectors and includes every block type needed to identify the field:

```text
content.photoBlock.gallery.heroImage
```

You will write these mostly in configuration and read them in error messages:

```ts
export const FAQBlockAdmin = defineBlockAdmin(FAQBlock, {
  fields: {
    'faq.answer': { editor: lexicalEditor(/* a smaller extension set */) },
  },
})
```

That key configures every `answer` declared at that location, not one array item. The example is real — `apps/webapp/byline/blocks/faq-block.admin.ts`.

Because plain text cannot distinguish a field name from a block type (both are bare dotted segments), the resolver checks the path against the schema rather than trusting its shape.

### Admin field overrides

Collection admin `fields{}` keys **cannot enter a blocks field**, even with the correct block type. Fields inside blocks take their overrides from the block-type-keyed `blockAdmin` registry instead, so one registration applies wherever that block renders. Startup validation rejects an override that enters a block and points you at `blockAdmin`.

A collection admin config may still name the blocks field itself — `content` — since the blocks field has its own label and description and naming it does not enter a block.

A block admin `fields{}` map is relative to the block root:

```text
faq.answer
```

It may enter groups and arrays, but a nested blocks field uses its own `blockAdmin`.

The core API expresses the rule as a resolver policy rather than a separate grammar:

```ts
resolveDeclarationPath(fields, key, { blocks: 'forbidden' })
```

## Persisted storage paths

Storage paths use dotted positions and include block types:

```text
content.0.photoBlock.gallery.1.heroImage
```

The Postgres adapter builds these as string arrays, joins them with `.` for storage, and splits them during reconstruction. It does not use `parseInstancePath`.

The block type is present because a value row has no `_type` column — block metadata lives separately in `store_meta`. Without `photoBlock`, Byline would need a metadata join to determine which schema owns the value. The format also permits a storage-level block-type filter without that join, though the public query API does not expose one.

The block metadata row for this example is stored at `content.0.photoBlock`, where the path records the type and `item_id` stores the block's `_id`. Array metadata uses paths such as `gallery.0`. Ordered has-many relations instead write one relation row per target at `authors.0`, `authors.1`, and so on, needing no `store_meta` identity because the target document id identifies the item.

### How storage paths relate to declaration paths

Removing positions from a storage path produces its collection-relative declaration path:

```text
content.0.photoBlock.gallery.1.heroImage   ← storage
content.photoBlock.gallery.heroImage       ← declaration (positions removed)
pages.content.photoBlock.gallery.heroImage ← upload registry key (collection prefixed)
```

This relationship does not mean one parser accepts all three. Storage handles dotted strings directly; the shared core module parses declaration paths and bracket-form instance paths. The block type must stay in storage: removing positions from `content.0.gallery.1.heroImage` would yield the invalid declaration path `content.gallery.heroImage`.

`packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` verifies the relationship against real flattener output.

## Upload paths and context

Uploads use three addresses at once:

| Address | Example | Purpose |
|---|---|---|
| Registry declaration key | `pages.content.photoBlock.gallery.heroImage` | Selects the server upload hook and configuration |
| Request `field` | `heroImage` | Selects an upload field by leaf name |
| Request and hook `fieldPath` | `content[id=…].gallery[id=…].heroImage` | Identifies the form value and its key in the hook fields bag |

Because `field` carries only the leaf name, **upload-capable leaf names must be unique within a collection.**

`UploadConfig.context` uses a separate relative addressing language:

```text
../caption
/title
```

Byline resolves these from the upload field's containing instance scope, the way filesystem paths resolve. Every dotted instance-path segment is currently navigational; if a future grammar adds metadata segments, context resolution must ignore them when counting parent scopes.

Missing values and paths above the document root are omitted. Each value enters the multipart request under its context path's leaf name, and for duplicate leaves the later value wins. If the block item is unavailable, upload resolution falls back to a declaration only when exactly one block variant matches — an ambiguous match produces no context.

## The shared path module

`packages/core/src/paths/` implements declaration and bracket-form instance paths. The Postgres adapter owns dotted storage paths. One segment type underpins both notations:

```ts
type PathSegment =
  | { kind: 'field'; name: string }
  | { kind: 'blockType'; blockType: string }
  | { kind: 'index'; index: number }
  | { kind: 'id'; id: string }
```

| Function | Purpose |
|---|---|
| `parseDeclarationPath` | Parses a dotted path with no selectors |
| `parseInstancePath` | Parses bracket selectors in `[n]` or `[id=…]` form |
| `formatDeclarationPath` | Formats a segment list as a declaration path |
| `formatInstancePath` | Formats a segment list as a bracket-form instance path |
| `toDeclarationSegments` | Removes selectors from a typed, schema-aware segment list |
| `resolveDeclarationPath` | Resolves a declaration path against fields, with qualified or forbidden block traversal |
| `walkFieldDeclarations` | Walks a schema and emits canonical declaration segments |

### What parsing does and does not validate

Parsers return a result rather than throwing — `{ ok: true, segments }` or `{ ok: false, reason }`, where `reason` is one of `empty`, `emptySegment`, `index` (a declaration path carrying an item index), or `malformed` (unparseable bracket syntax).

They validate **syntax only**, not your schema or your document. `parseInstancePath` accepts selector-free paths and consecutive selectors; it does not prove that a selector follows an array or blocks field, that a field exists, or that an id exists. There is no general schema-aware `resolveInstancePath` — consumers apply the semantics they need.

`parseDeclarationPath` initially classifies every bare segment as a field, because text alone cannot distinguish `photoBlock` from a field name. `resolveDeclarationPath` reclassifies them against the schema and reports one of three outcomes: `ok` with the resolved field, `blocks` when traversal hit a blocks field under `blocks: 'forbidden'`, or `unresolved`. The `blocks` case is distinct on purpose — it means your path is *correct* but used somewhere block traversal is barred, so the guidance is "use `blockAdmin`", not "your path is wrong".

A schema walker already knows each segment's kind, so `walkFieldDeclarations` emits `blockType` segments directly. Its `onBlock` callback visits empty blocks too, which is what stops validation from skipping them.

### Convert typed segments, not raw text

`toDeclarationSegments` removes selectors from *typed* segments. Do not split text and discard the numeric components: a field can legitimately be named `0`, and the typed form preserves it as a field.

The conversion cannot add a block type that an instance path omitted. Start from schema-aware segments, or inspect the selected item's `_type`.

### Character and length limits

Path segments are not escaped or quoted. Collection paths, field names, and block types used by upload indexing must be non-empty and cannot contain `.`, `[`, or `]`.

The form path helper does not support quoted keys, negative indices, or paths supplied as arrays.

Database columns impose these limits:

- `field_path`: 500 characters
- `parent_path`: 500 characters
- `field_name`: 255 characters

## Compatibility boundaries

Persisted and client/server path formats cannot be changed as internal refactors.

**Storage paths require a migration.** Changing the stored `field_path` format means a data migration. The instance parser can parse a dotted storage string as text, but it will treat positions and block types as field names — so do not pass storage paths to `parseInstancePath`.

**Patch paths are a wire format.** They cross the client/server boundary, so a change must account for mismatched client and server versions, saved payloads, and every consumer. Treat patch syntax as a protocol.

## Rejected design — block-qualified runtime paths

Form and patch paths carry no block type; persisted storage paths do, because a stored value row has no `_type` column while an in-memory block item does. Carrying the block type through the runtime notations as well — so that one visually consistent notation appeared in logs, patch payloads, and storage rows — was implemented in full on 2026-07-19 and then abandoned rather than merged. This section records why, so the design is not proposed a second time.

The added segment addresses nothing in the data. Block items are stored flat, as `{ _id, _type, ...fields }`, so every consumer had to recognise the segment and skip it. Three consumers did: the patch walkers, the admin form store, and upload resolution. Three defects followed.

1. A reorder combined with a heterogeneous block wrote a phantom object into a stale item.
2. The block type was carried but never enforced, so a mismatched segment silently edited the real field. The cost of an assertion was paid without gaining the integrity of one.
3. `UploadConfig.context` regressed. `resolveContextPath` counts every dotted segment as one scope level, so `../` stopped inside the block instead of reaching the document root — a public API regression, confirmed by direct test.

The general lesson is the third one. Each non-navigating segment creates another place that must know to erase it, and nothing enforces that obligation. Two of the three consumers were missed on the first implementation pass, and the third was found only in review. The cost kept growing while the value stayed fixed at visual consistency alone.

Both of the real benefits — resolving the exact block declaration, and resolving an upload without form data — are obtainable from a schema-and-data-aware resolver that reads `_type`, with no change to any payload.

Revisit this only for a genuinely cold consumer: a persisted operation log, peer synchronisation, or collaborative editing, where a path is read without the document in hand. At that point the block type becomes load-bearing rather than decorative, and it should be a validated assertion that is rejected on mismatch, parsed centrally, and explicitly ignored by relative-scope arithmetic — not a pseudo-navigation segment that every data walker strips. The regression in (3) is pinned by `packages/admin/src/forms/upload-executor.test.node.ts` ("climbs out of the block to the document root").

## Other path-like APIs

These have narrower contracts and must not be passed to the shared resolvers:

| API | Example | Contract |
|---|---|---|
| `walkFieldTree` diagnostics | `content.1.richText` | Runtime positions without block types; logs and errors only |
| Rich-text startup diagnostics | `content.<photoBlock>.caption` | Diagnostic notation with block types in angle brackets |
| Search configuration | `title`, `content` | Top-level field names; a named body container is traversed recursively |
| Relation `where` | `{ gallery: { $some: { path: 'news' } } }` | Nested query objects resolved within each relation target |
| Populate map | `{ author: true }` | Relation leaf names matched anywhere in the field tree; same-named leaves share a selector |
| Upload context | `../caption`, `/title` | Relative or root addressing resolved from an instance scope |

`validateCollections` uses block-qualified declaration paths, but other validators may use their own diagnostic format — "startup error path" does not identify one grammar.

The counter allocator uses dotted keys to read previous values and stops at arrays. Counters cannot appear inside arrays or blocks, so it is not a field path API.

## Implementation reference

| Location | Responsibility |
|---|---|
| `core/storage/storage-flatten.ts`, `db-postgres/…/storage-insert.ts` | Produces and serializes dotted storage paths |
| `core/storage/storage-restore.ts`, `db-postgres/…/storage-queries.ts` | Reads dotted storage paths |
| `core/config/attach-hooks.ts` | Produces upload registry keys |
| `core/config/validate-collections.ts` | Produces collection validation paths |
| `core/config/validate-admin-configs.ts` | Resolves admin `fields{}` keys |
| `core/patches/apply-patches.ts` | Reads patch paths |
| `admin/forms/nested-path.ts` | Reads and writes form state using bracket instance paths |
| `admin/forms/repeating-items.ts` | Produces stable-id form paths with positional fallback |
| `admin/forms/upload-executor.ts` | Resolves upload fields and context |

## Contract tests

The central contracts are covered by:

- `packages/core/src/paths/path-dialects.test.node.ts` — configuration and patch formats, including two block types that declare the same field name.
- `packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` — real flattener output and the relationship between stored and declaration paths.

Form behaviour is covered by `nested-path.test.node.ts`, `repeating-items.test.node.ts`, `upload-executor.test.node.ts`, and `pending-uploads.test.node.ts`, all in `packages/admin/src/forms/`.

Search, relation, populate, and diagnostic APIs have separate tests. A new path-like notation does not automatically enter the central contract tests.

## Collection fingerprints are separate

The runtime collection fingerprint includes the collection path, field names, selected field properties, structure, and block types. With an unchanged collection path, changing an included component normally increments the collection version. Changing the collection path registers a new collection unless a migration handles the rename.

Generated collection types have a separate output hash. Neither hash validates path grammar, and neither includes admin overrides, upload hooks, search configuration, or upload context.
</content>
