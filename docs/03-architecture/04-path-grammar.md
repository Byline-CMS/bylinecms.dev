---
title: "Path Grammar"
path: "path-grammar"
summary: "How Byline identifies fields in stored documents, schemas, patches, forms, and upload configuration."
---

# Path Grammar

Companions:

- [Document Storage](./01-document-storage.md) explains how `field_path` and
  `store_meta.path` appear in stored rows.
- [Fields](../04-collections/01-fields.md) explains which path format each
  collection option accepts.
- [Collections](../04-collections/index.md) documents upload hooks. Their
  registry keys are declaration paths.
- [Blocks](../04-collections/02-blocks.md) explains why field overrides inside
  blocks use the `blockAdmin` registry.

Byline uses paths in database storage, schema configuration, validation errors,
form state, patches, and uploads. These paths look similar, but they do not all
identify the same thing:

- An **instance path** identifies a value in one document.
- A **declaration path** identifies a field in a collection schema.

Database storage uses a third, persisted notation. This guide explains when to
use each format, then documents their APIs and limits.

## Why Byline needs field paths

A Byline document can contain nested groups, arrays, blocks, and relations.
Rather than storing the document as one opaque JSON value, Byline flattens its
values into typed tables such as `store_text`, `store_numeric`, and
`store_file`. This keeps the values available to relational indexes,
constraints, queries, and transactions.

Each row needs a path so Byline can reconstruct the document. For example, the
path can identify the alt text for the first image in a gallery inside the
second block on a page. Arrays and blocks also produce `store_meta` rows for
item identity. Groups do not produce rows of their own, and absent, `null`, and
virtual values are not stored. [Document Storage](./01-document-storage.md)
documents the full mapping.

Saving still creates one immutable document version. Byline's admin user
interface sends patches, the server applies them to the reconstructed
document, and the complete result for the edited locale is flattened into a
new version. Other locales are carried forward. Paths identify values within
that version; they do not create separate versions or audit histories for
individual fields.

## Two questions, two kinds of path

Most Byline paths answer one of two questions:

1. Which value in this document do you mean?
2. Which field in this schema do you mean?

The answer determines whether to use an instance path or a declaration path.

### Instance paths identify document values

An instance path identifies a value in one document. It selects array and block
items by stable ID or position.

```text
content[id=block-id].gallery[id=image-id].alt
```

The path does not include a block type. The selected block item already
contains `_type`, which identifies its schema. Selectors are only needed inside
repeating fields, so these are also valid instance paths:

```text
title
metadata.caption
content
```

The first two identify values; `content` can be a structural patch target.

Byline prefers `[id=…]` because it continues to identify the same item after a
reorder. `[0]` identifies whichever item is first when the path is evaluated.
Stable IDs keep form state, hooks, deferred uploads, and patches attached to
the intended item. They do not resolve concurrent saves; the document-version
conflict check handles that separately.

### Declaration paths identify schema fields

A declaration path identifies a field definition in a collection schema. It
contains no item selectors.

```text
content.photoBlock.gallery.alt
```

Declaration paths include the block type because different blocks can declare
fields with the same name. Without `photoBlock`, `content.gallery.alt` could be
ambiguous.

These paths appear most often in configuration and error messages. For example:

```ts
export const FAQBlockAdmin = defineBlockAdmin(FAQBlock, {
  fields: {
    'faq.answer': { editor: lexicalEditor(/* a smaller extension set */) },
  },
})
```

The key configures every `answer` declared at that location, not one array
item. The example comes from
`apps/webapp/byline/blocks/faq-block.admin.ts`. Block-qualified paths also keep
validation errors unambiguous.

## Path formats at a glance

The examples below all refer to an upload-capable `heroImage` field with this
schema:

```text
collection: pages
blocks field: content
block type: photoBlock
array field: gallery
field: heroImage
```

| Context | Path | What it identifies |
|---|---|---|
| Stored `field_path` | `content.0.photoBlock.gallery.1.heroImage` | One stored value, using dotted positions and a block type |
| Upload hook registry | `pages.content.photoBlock.gallery.heroImage` | One upload field declaration, prefixed by collection |
| Collection validation | `content.photoBlock.gallery.heroImage` | One field declaration |
| Collection admin `fields{}` | Not reachable through blocks | Block traversal is rejected |
| Block admin `fields{}` | `gallery.heroImage` | One declaration relative to the block root |
| Field patch | `content[id=…].gallery[id=…].heroImage` | One document value |
| Structural patch | `content` or `content[id=…].gallery` | A repeating container |
| Form state | `content[id=…].gallery[id=…].heroImage` | One document value, with positional fallback when needed |

Patch paths and form paths use the same bracket notation. Both
`parseInstancePath` and the form path helpers accept `[id=…]` and `[n]`
selectors.

Structural `array.move` and `array.remove` patches work slightly differently.
The patch `path` identifies the array or blocks field, and a separate `itemId`
identifies the item. When stable identity is unavailable, `itemId` may be a
numeric position.

## Persisted storage paths

Storage paths use dotted positions and include block types:

```text
content.0.photoBlock.gallery.1.heroImage
```

The Postgres adapter builds these paths as string arrays, joins them with `.`
for storage, and splits them during reconstruction. It does not use
`parseInstancePath`.

The path includes the block type because a value row has no `_type` column.
Block metadata is stored separately in `store_meta`. Without `photoBlock`,
Byline would need related metadata to determine which schema owns the value.
The current format also permits a storage-level block-type filter without a
metadata join, although the public query API does not expose one.

The block metadata row for this example is stored at:

```text
content.0.photoBlock
```

The path records the type, and `item_id` stores the block's `_id`. Array
metadata uses paths such as `gallery.0`. Ordered has-many relations instead use
one relation row per target at `authors.0`, `authors.1`, and so on. They need no
`store_meta` identity because the target document ID identifies the item.

### How storage paths relate to declaration paths

Removing positions from a storage path produces its collection-relative
declaration path:

```text
content.0.photoBlock.gallery.1.heroImage
content.photoBlock.gallery.heroImage
pages.content.photoBlock.gallery.heroImage
```

The second line removes positions to produce the declaration path. The third
adds the collection prefix used by the upload hook registry.

This relationship does not mean one parser accepts all three formats. Storage
handles dotted strings directly; the shared core module parses declaration
paths and bracket-form instance paths. The block type must remain in storage:
removing positions from `content.0.gallery.1.heroImage` would produce the
invalid declaration path `content.gallery.heroImage`.

`packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` verifies
this relationship from real flattener output.

## Form and patch paths

The admin user interface uses instance paths for form state, hooks, conditions,
deferred uploads, and patches.

For canonical array and block items, Byline emits stable ID selectors:

```text
content[id=block-id].gallery[id=image-id].heroImage
```

New items receive `_id` values in the browser before the first save. Reordering
updates both the rendered list and the form store.

A stable form write fails if its ID no longer exists. This stops late
asynchronous work from recreating a removed item or changing a sibling.
Removing an item clears its pending uploads. During upload execution, the form
is inert so structural edits cannot invalidate the save's upload snapshot.

### Positional fallback

Form paths retain `[n]` for legacy items and create defaults without a usable
ID. An `[id=…]` value must be a non-empty string without `.`, `[`, or `]`.
Structural edits keep positional form state synchronized immediately, but a
position is not stable across deferred work and reorders. Use canonical `_id`
data when identity must survive them.

### Patch application

`parsePatchPath` uses `parseInstancePath` but preserves the existing patch
segment property `key` instead of `name`. Malformed paths produce no segments,
so their patches are rejected rather than applied to a partial path.

This is syntax validation, not full schema validation. Field resolution remains
best-effort and searches block variants by child name rather than the selected
item's `_type`. Server-side `field.set` can also create an `{ _id }` item when
an ID is absent, while admin form writes deliberately fail if an ID target has
disappeared.

A positional patch uses the array order at that point in the patch stream.
The optimistic concurrency check rejects a stale `documentVersionId` rather
than rebasing it across a reorder saved by another request.

## Declaration paths in configuration

Declaration paths support schema-aware configuration, upload hook registration,
and validation messages. They contain no selectors and include every block
type needed to identify the field:

```text
content.photoBlock.gallery.heroImage
```

The resolver checks the path against the schema because text alone cannot
distinguish a field name from a block type. Both are bare dotted segments.

### Admin field overrides

Collection admin `fields{}` keys cannot enter a blocks field, even with the
correct block type. Fields inside blocks use the block-type-keyed `blockAdmin`
registry instead. That registration applies wherever the block renders.
Startup validation rejects an override that enters a block and directs the
developer to `blockAdmin`.

A collection admin configuration may still name the blocks field itself:

```text
content
```

The blocks field has its own label and description, so this does not enter a
block.

A block admin `fields{}` map is relative to the block root:

```text
faq.answer
```

It may enter groups and arrays, but a nested blocks field uses its own
`blockAdmin`.

The core API expresses this rule as:

```ts
resolveDeclarationPath(fields, key, { blocks: 'forbidden' })
```

This is a resolver policy, not a separate grammar.

## Upload paths and context

Uploads use three addresses:

| Address | Example | Purpose |
|---|---|---|
| Registry declaration key | `pages.content.photoBlock.gallery.heroImage` | Selects the server upload hook and configuration |
| Request `field` | `heroImage` | Selects an upload field by leaf name |
| Request and hook `fieldPath` | `content[id=…].gallery[id=…].heroImage` | Identifies the form value and its key in the hook fields bag |

Upload-capable leaf names must be unique within a collection because `field`
contains only the leaf name.

`UploadConfig.context` uses a separate relative addressing language:

```text
../caption
/title
```

Byline resolves these strings from the upload field's containing instance scope
in the same way as filesystem paths. Every dotted instance-path segment is
currently navigational. If a future grammar adds metadata segments, context
resolution must ignore them when counting parent scopes.

Missing values and paths above the document root are omitted. Each value enters
the multipart request under its context path's leaf name; for duplicate leaves,
the later value wins. If the block item is unavailable, upload resolution uses
a declaration only when exactly one block variant matches. An ambiguous match
produces no context.

## The shared path module

`packages/core/src/paths/` implements declaration and bracket-form instance
paths. The Postgres adapter owns dotted storage paths. Shared APIs use:

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

Parsers validate syntax, not the collection schema or document.
`parseInstancePath` accepts selector-free paths and consecutive selectors. It
does not prove that a selector follows an array or blocks field, that a field
exists, or that an ID exists. There is no general schema-aware
`resolveInstancePath`; consumers apply the semantics they need.

`parseDeclarationPath` initially classifies bare segments as fields because
text cannot distinguish `photoBlock` from a field name.
`resolveDeclarationPath` reclassifies them against the schema.

A schema walker already knows each segment's kind, so
`walkFieldDeclarations` emits `blockType` segments directly. Its `onBlock`
callback also visits empty blocks, ensuring validation does not miss them.

### Convert typed segments, not raw text

`toDeclarationSegments` removes selectors from typed segments. Do not split
text and discard numeric components: a field can legitimately be named `0`.
The typed form preserves it as a field.

The conversion cannot add a block type omitted from an instance path. Start
with schema-aware segments or inspect the selected item's `_type`.

### Character and length limits

Path segments are not escaped or quoted. Collection paths, field names, and
block types used by upload indexing must be non-empty and cannot contain `.`,
`[`, or `]`.

The form path helper does not support quoted keys, negative indices, or paths
provided as arrays.

Database columns impose these length limits:

- `field_path`: 500 characters
- `parent_path`: 500 characters
- `field_name`: 255 characters

## Compatibility boundaries

Persisted and client/server path formats cannot change as internal refactors.

### Storage paths require a migration

Changing storage `field_path` requires a data migration. The instance parser
can parse a dotted storage string as text, but it treats positions and block
types as field names. Do not pass storage paths to `parseInstancePath`.

### Patch paths are a wire format

Patch paths cross the client/server boundary. A change must account for
different client and server versions, saved payloads, and every consumer. Treat
patch syntax as a protocol.

## Other path-like APIs

These path-like APIs have narrower contracts and must not be passed to the
shared resolvers:

| API | Example | Contract |
|---|---|---|
| `walkFieldTree` diagnostics | `content.1.richText` | Runtime positions without block types; used only in logs and errors |
| Rich-text startup diagnostics | `content.<photoBlock>.caption` | Diagnostic notation with block types in angle brackets |
| Search configuration | `title`, `content` | Top-level field names; a named body container is traversed recursively |
| Relation `where` | `{ gallery: { $some: { path: 'news' } } }` | Nested query objects resolved within each relation target |
| Populate map | `{ author: true }` | Relation leaf names matched anywhere in the field tree; same-named leaves share a selector |
| Upload context | `../caption`, `/title` | Relative or root addressing resolved from an instance scope |

`validateCollections` uses block-qualified declaration paths. Other validators
may use their own diagnostic format, so "startup error path" does not identify
one grammar.

The counter allocator uses dotted keys to read previous values and stops at
arrays. Counters cannot appear inside arrays or blocks, so this is not a field
path API.

## Implementation reference

| Location | Responsibility |
|---|---|
| `db-postgres/…/storage-flatten.ts`, `storage-insert.ts` | Produces and serializes dotted storage paths |
| `db-postgres/…/storage-restore.ts`, `storage-queries.ts` | Reads dotted storage paths |
| `core/config/attach-hooks.ts` | Produces upload registry keys |
| `core/config/validate-collections.ts` | Produces collection validation paths |
| `core/config/validate-admin-configs.ts` | Resolves admin `fields{}` keys |
| `core/patches/apply-patches.ts` | Reads patch paths |
| `admin/forms/nested-path.ts` | Reads and writes form state using bracket instance paths |
| `admin/forms/repeating-items.ts` | Produces stable-ID form paths with positional fallback |
| `admin/forms/upload-executor.ts` | Resolves upload fields and context |

## Contract tests

The central contracts are covered by:

- `packages/core/src/paths/path-dialects.test.node.ts` covers configuration and
  patch formats, including two block types that declare the same field name.
- `packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` covers
  real flattener output and the relationship between stored and declaration
  paths.

Form behavior is covered by:

- `packages/admin/src/forms/nested-path.test.node.ts`
- `packages/admin/src/forms/repeating-items.test.node.ts`
- `packages/admin/src/forms/upload-executor.test.node.ts`
- `packages/admin/src/forms/pending-uploads.test.node.ts`

Search, relation, populate, and diagnostic APIs have separate tests. A new
path-like notation does not automatically enter the central contract tests.

## Collection fingerprints are separate

The runtime collection fingerprint includes the collection path, field names,
selected field properties, structure, and block types. With an unchanged
collection path, changing an included component normally increments the
collection version. Changing the collection path registers a new collection
unless a migration handles the rename.

Generated collection types have a separate output hash. Neither hash validates
path grammar or includes admin overrides, upload hooks, search configuration,
or upload context.
