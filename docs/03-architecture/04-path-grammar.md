---
title: "Path Grammar"
path: "path-grammar"
summary: "How Byline addresses fields across persisted storage, schema declarations, patches, and forms; where the dialects correspond, and where their contracts deliberately differ."
---

# Path Grammar

Companions:
- [Document Storage](./01-document-storage.md) — `field_path` on value-store rows and `path` on `store_meta` rows carry persisted dotted paths; that document shows real rows.
- [Fields](../04-collections/01-fields.md) — the author-facing account: which notation each config option takes.
- [Collections](../04-collections/index.md) — upload hook registry keys (`ServerConfig.hooks.uploads`) are declaration paths.
- [Blocks](../04-collections/02-blocks.md) — why per-field admin overrides inside a block come from the `blockAdmin` registry rather than a path.

## Why a field has an address at all

Byline does not store a document as a JSON blob. Persisted value leaves become
rows in typed store tables — `store_text`, `store_numeric`, `store_file`, and
the rest — selected by field type. Arrays and blocks also emit `store_meta`
rows for item identity; groups emit no row of their own; absent, `null`, and
virtual values emit no row. [Document Storage](./01-document-storage.md) covers
the complete mapping.

That representation makes fields independently addressable and queryable, but
it does not make a save a field-only version. The admin sends patches, the
lifecycle applies them to a reconstructed document, and the database creates a
new immutable document version by flattening the complete resulting data for
the edited locale (while carrying forward other locales). Paths identify the
rows inside that version; they are not a per-field version history or audit
diff.

Content is hierarchical by nature; a relational database is not, and it is
extremely good at what it does instead — indexing, constraints, set-based
queries, transactional integrity. Flattening and reconstruction is the bridge
between the two. Decomposing a document into typed rows on the way in, and
rebuilding the hierarchy on the way out, is what lets a tree-shaped document
enjoy the strengths of an RDBMS rather than sitting opaquely inside a single
column.

The bridge only holds if it carries the structure across intact. Each row has
to record precisely where in the hierarchy its value came from — enough to
rebuild the document in the shape the editor handed over, down to the fourth
item of an array nested inside the second block of a blocks field.

That record is a field path. It is a string: value rows store it in
`field_path`, while structural identity rows use `store_meta.path`. It is the
reason a row knows it holds the alt text of the first image in the gallery of
the photo block at position 1 — rather than just holding the string
`"Sunrise over the bay"`.

## The same question across the system

Storage is where paths start, but it is not where they stop. Several parts of
Byline need to point at a field. The four central cases below explain the two
main concepts; later sections document narrower diagnostics and configuration
APIs that intentionally use other shapes.

**Taking a document apart, and putting it back.** The flattener emits one path
per value on the way in; the reconstructor reads those paths back into nested
shape on the way out. The round trip has to be lossless — a path that cannot
express "inside this block variant" is a document that comes back wrong.

**Editing one field without sending the document.** When you change a caption
in the admin UI, the editor sends a patch that names what changed rather than
posting the whole document:

```
content[id=01924f…].gallery[id=01924g…].alt
```

Addressing items by stable id rather than position is what keeps that patch
bound to the same item when the gallery is reordered earlier in the editing
session or patch stream. Saved concurrent edits are handled separately by the
document-version conflict check. Stable addressing is one prerequisite for
more collaborative behavior later, not conflict resolution by itself.

**Saying how a field should behave.** This is the one you will meet while
configuring your own installation. An FAQ answer is a `richText` field nested
inside an array inside a block, and it should not offer the same editor as a
full page body — no tables, no embeds, no layout, just prose with lists and
links. You say so by addressing the field's *declaration*:

```ts
export const FAQBlockAdmin = defineBlockAdmin(FAQBlock, {
  fields: {
    'faq.answer': { editor: lexicalEditor(/* a smaller extension set */) },
  },
})
```

(The real thing is `apps/webapp/byline/blocks/faq-block.admin.ts`.) Note what
that key does *not* have: no item index. It is not describing the answer of the
third FAQ in one document — it is describing every answer field in every FAQ
item of every document that uses this block. The same shape configures a
compact editor for a photo caption, a custom widget for a field, or a slot in a
layout.

**Telling an author which field is wrong.** If two blocks in the same field
both declare `alt`, a validation error saying `content.alt` has told the author
almost nothing. It has to say which `alt`:

```
content.photoBlock.gallery.alt
```

The first two of those address a **value in a particular document**. The second
two address a **declaration in the schema** — a rule about a field, held once,
applying everywhere that field appears. That distinction turns out to explain
the central differences between the notations that follow.

## Two categories

The shared configuration and editing path APIs distinguish two categories by
what the path addresses. Persisted storage carries the same information in an
older dotted dialect described separately below.

**Instance paths address a value in one document.** A selector is required only
when the path descends into one particular repeating item. Top-level and group
paths (`title`, `metadata.caption`) and structural patch targets (`content`) are
valid without one. A block type is absent because the addressed item carries
its own `_type`.

```
content[id=block-id].gallery[id=image-id].alt
```

**Declaration paths address a field declaration in the schema.** There are no
item selectors. A block type is **required**, because without it two blocks
declared in the same field cannot be told apart.

```
content.photoBlock.gallery.alt
```

Both defects that motivated consolidating the shared path APIs were failures of
that rule. An ambiguous declaration path — one that dropped the block type —
could not say which of two `alt` declarations a validation error referred to.
And an instance path resolved *without* consulting the item's `_type` picked
the wrong block, silently dropping that field's `upload.context`. Neither was
only a tokenisation bug; both were consumers applying the wrong path semantics.

### The projection relationship

Take a persisted storage path for an upload-capable image field and remove its
positional segments:

```
content.0.photoBlock.gallery.1.heroImage
  → content.photoBlock.gallery.heroImage
  → pages.content.photoBlock.gallery.heroImage
```

The first projection is the collection-relative declaration path; prefixing the
collection produces the upload hook registry key. This is a useful
**correspondence**, not one parser operating on both strings.
Storage constructs and restores dotted `string[]` paths directly. The shared
core module parses declaration paths and bracket-form instance paths; it does
not parse the persisted storage dialect. A storage contract test derives the
elision relationship from real flattener output by splitting and filtering the
dotted string (`packages/db-postgres/src/modules/storage/storage-paths.test.node.ts`).

The shared `PathSegment` type can represent fields, block types, indices, and
IDs, so schema-aware producers can format a known segment list for either
declaration or bracket-instance use. Parsing an instance string alone cannot
reconstruct an omitted block type; resolving that relationship requires the
schema and the addressed block item's `_type`.

### Storage is its own persisted dialect

Storage `field_path` carries position and block type —
`content.0.photoBlock.gallery.1.heroImage` — where a patch path for the same
value carries bracket selectors and omits the type. Storage builds these paths
as arrays of strings, joins them with `.` for insertion, and splits them on `.`
for reconstruction. It does not call `parseInstancePath`.

The difference is what else is in reach at the moment the path is read. In
memory, resolving `content[0].alt` means the item is right there and can be
asked its `_type`. A value row has no `_type` column; the separate
`store_meta.path` encodes the block type. A row addressed `content.0.alt` would
need a join against its siblings before anyone could say which block's `alt` it
holds. Including the block type in each stored path makes the row
self-describing. It would also allow a storage-level query to filter by block
type without joining the meta row, although the current public query DSL does
not expose that predicate.

It is also what makes the elision above work. Strip the positional segments from
`content.0.photoBlock.gallery.1.heroImage` and a valid declaration path falls
out. Strip them from a hypothetical `content.0.gallery.1.heroImage` and you get
`content.gallery.heroImage`, which resolves to nothing, because the
discriminator was never written down. The elision test guards exactly this.

The block's meta row is stored at `content.0.photoBlock`: the path encodes the
block type, while its `item_id` column stores `_id`. Array meta rows use paths
such as `gallery.0`. Ordered has-many relations are different again: each
target is one relation row at `authors.0`, `authors.1`, and so on, with no
`store_meta` item identity because the target document ID is the identity.

## The notations

Target field throughout this table: upload-capable image field `heroImage`,
inside array `gallery`, inside block `photoBlock`, inside blocks field
`content`, in collection `pages`.

| Notation | For that field | Selectors | Block type |
|---|---|---|---|
| Storage `field_path` | `content.0.photoBlock.gallery.1.heroImage` | `.n` positional | after the index |
| Upload hook registry | `pages.content.photoBlock.gallery.heroImage` | none | required, collection-prefixed |
| Collection-schema validation | `content.photoBlock.gallery.heroImage` | none | required |
| Collection admin `fields{}` | *unreachable — see below* | rejected | traversal rejected |
| Block admin `fields{}` | `gallery.heroImage` | none | block-root-relative |
| Field patch paths | `content[id=…].gallery[id=…].heroImage` | `[n]` or `[id=…]` | absent |
| Structural patch paths | `content` or `content[id=…].gallery` | only for enclosing items | absent |
| Form instance paths | `content[id=…].gallery[id=…].heroImage` | `[id=…]`, with `[n]` fallback | absent |

The patch and form rows use the same bracket notation. Both parse through
`parseInstancePath` and accept either selector form. Producers prefer
`[id=…]` because field state, hooks, deferred uploads, and patches can outlive a
reorder that would invalidate a position. Form paths retain `[n]` for id-less
or path-unsafe create defaults and legacy data. Structural edits keep that
fallback's immediate form-store order coherent, but only canonical `_id` paths
provide stable identity to deferred or asynchronous work across a reorder.

Structural `array.move` and `array.remove` patches identify the container with
the patch `path` and the item separately with `itemId`; their positional
fallback is a numeric `itemId`, not a bracket selector appended to the path.

Two further dotted notations exist and are deliberately **not** field paths:

- `UploadConfig.context` (`../caption`, `/title`) is a *relative* addressing
  language layered on top of an instance path, resolved filesystem-style
  against the upload field's containing scope.
- The counter allocator's previous-value lookup walks a data object and stops
  at any array. Counters cannot be declared inside `array` / `blocks`, so it
  needs neither selectors nor block types.

Uploads carry three different addresses that should not be conflated:

| Upload address | Example | Purpose |
|---|---|---|
| Registry declaration key | `pages.content.photoBlock.gallery.heroImage` | Selects server hook/config; collection-prefixed and block-qualified. |
| Request `field` | `heroImage` | Selects an upload field by leaf name; upload-capable leaf names must be unique within a collection. |
| Request/hook `fieldPath` | `content[id=…].gallery[id=…].heroImage` | Identifies the runtime form value and reaches hooks in the request fields bag. |

`UploadConfig.context` paths resolve textually from the upload field's
containing instance scope. Missing values and paths that climb above the root
are omitted. Values are serialised into multipart fields named by the context
path's leaf; if duplicate leaves are appended, the server's fields bag retains
the later value. If the addressed block item is unavailable, the executor
accepts a declaration only when exactly one block variant matches, otherwise it
sends no context for that ambiguous field.

## The shared module

`packages/core/src/paths/` is the shared implementation for declaration paths
and bracket-form instance paths. Persisted dotted storage paths remain in the
Postgres adapter. One segment AST backs the shared serialisations:

```ts
type PathSegment =
  | { kind: 'field'; name: string }
  | { kind: 'blockType'; blockType: string }
  | { kind: 'index'; index: number }
  | { kind: 'id'; id: string }
```

| Function | Purpose |
|---|---|
| `parseDeclarationPath` | Dotted, index-free. Rejects selectors outright. |
| `parseInstancePath` | Bracket selectors, positional or `[id=…]`. |
| `formatDeclarationPath` / `formatInstancePath` | Serialise a segment list either way. |
| `toDeclarationSegments` | Drop selectors from an already typed/schema-aware segment list. |
| `resolveDeclarationPath` | Resolve against a field set; `blocks: 'qualified' \| 'forbidden'`. |
| `walkFieldDeclarations` | The canonical schema walk, with an `onBlock` callback. |

The parsers validate syntax, not schema semantics. `parseInstancePath` accepts
selector-free paths and consecutive selectors; it does not prove that a
selector follows an array/blocks field, that a field exists, or that an ID is
present in document data. There is currently no general schema-aware
`resolveInstancePath`; consumers apply the semantics they need.

### Parsing cannot classify a block type

A block type and a field name are both bare identifiers, so **parsing is
schema-unaware**: `parseDeclarationPath` returns only `field` segments.
`resolveDeclarationPath` reclassifies them against a field set and returns
correctly typed segments the parser could not have produced.

Producers are the other way round. A caller walking a schema already knows
which is which, so `walkFieldDeclarations` emits `blockType` segments directly.
Canonical declaration-path producers should use it rather than re-implementing
the descent. Some service diagnostics intentionally retain narrower legacy
walkers and are listed under [Adjacent path-like APIs](#adjacent-path-like-apis).

`onBlock` exists because a block declaring no fields is invisible to a
field visitor, and validation that must see every block (the dot-free check on
block types, for one) would silently stop covering those.

### Projection is done over segments, not text

`toDeclarationSegments` filters a typed list. The equivalent regex over raw
text — `/^\d+$/` against each dot-separated part — deletes a field legitimately
named `0`. Working over segments cannot, because `0` there is a `field`.

It does not invent a block discriminator omitted from a parsed instance path.
The safe instance-to-declaration projection therefore starts from a
schema-aware segment list, or resolves the addressed block item before looking
up its declaration.

### Lexical and length limits

Path segments are not escaped or quoted. Collection paths, field names, and
block types used by upload indexing must be non-empty and cannot contain `.`,
`[`, or `]`. Form stable IDs use `[id=…]` only for non-empty strings without
those characters; unsafe or noncanonical IDs fall back to position.

The form helper deliberately does not support quoted keys, negative indices,
or array-form paths. The persisted database columns cap `field_path` and
`parent_path` at 500 characters and `field_name` at 255 characters.

## What is frozen

**Storage `field_path` is persisted data.** Changing that grammar is a
migration, not a refactor. It is documented here and pinned by tests; it is not
a candidate for change. The bracket-instance parser does not recognise dotted
storage syntax: it parses the string successfully, but misclassifies numeric
and block-type components as ordinary field names.

**Patch paths are a wire format.** `parsePatchPath` delegates to
`parseInstancePath` — the two agree on every well-formed path — but the segment
shape it returns (`key` rather than `name`) is preserved for its consumers. A
malformed path yields no segments, so the patch is rejected rather than applied
at a truncated path.

That is a syntactic guarantee, not complete schema validation. Patch field
resolution is best-effort and currently searches block variants by child field
name rather than resolving the addressed item's `_type`. Patch application is
data-driven: stable IDs prevent reorder mis-targeting when the item exists, but
server-side `field.set` path creation can synthesise an `{ _id }` item when an
ID is absent. Admin form writes deliberately fail closed for a missing ID, so
normal stale asynchronous UI work does not enqueue such a patch.

Positional field patches resolve against the array order at that point in the
patch stream. Updates that supply a stale `documentVersionId` fail the
optimistic-concurrency check instead of being rebased across another saved
reorder.

## Admin's deliberate narrowing

Admin `fields{}` override keys are declaration paths with block traversal
**barred entirely**, even when correctly qualified. For collection admin, a
field inside a block must take its override from the blockType-keyed
`blockAdmin` registry instead, so one registration applies wherever that block
renders — in any collection, at any nesting depth. Boot validation rejects a
collection-level key that reaches into a block and points the author at
`blockAdmin`.

A block admin's own `fields{}` map is valid and resolves relative to that block
root: `faq.answer`, not `content.faqBlock.faq.answer`. It may descend through
groups and arrays but may not traverse a nested blocks field; that nested block
uses its own `blockAdmin` registration.

What is barred is *traversal*. A key naming the blocks field itself —
`content`, not `content.photoBlock.gallery.alt` — resolves normally, because
that field carries a label and a description like any other and overriding it
says nothing about the blocks inside it.

This is expressed as `resolveDeclarationPath(fields, key, { blocks: 'forbidden' })`
— a policy on the shared resolver, not a second grammar.

## Adjacent path-like APIs

Not every nested configuration or diagnostic string is one of the canonical
field paths above. These APIs have narrower contracts and must not be fed to the
shared path resolvers:

| Site | Shape | Contract |
|---|---|---|
| `walkFieldTree` diagnostics | `content.1.richText` | Dotted runtime positions, no block discriminator; for logs/errors only. |
| Rich-text boot diagnostics | `content.<photoBlock>.caption` | Schema diagnostic with angle-bracketed block types; not a declaration-path input. |
| Search config | `title`, `content` | Top-level field names only; a named body container is traversed recursively. |
| Relation `where` | `{ gallery: { $some: { path: 'news' } } }` | Nested query objects; each relation scope resolves top-level keys against its target collection. |
| Populate map | `{ author: true }` | Relation leaf names matched anywhere in the field tree, not rooted paths. Same-named leaves share the selector. |
| Upload context | `../caption`, `/title` | Relative/root language resolved against an instance scope. |

Collection-schema validation produced by `validateCollections` uses canonical
block-qualified declaration paths. Other validators may use their dedicated
diagnostic notation, so “boot error path” alone does not identify a grammar.

## Where each notation lives

| Site | Role |
|---|---|
| `db-postgres/…/storage-flatten.ts`, `storage-insert.ts` | produces and serialises dotted storage paths |
| `db-postgres/…/storage-restore.ts`, `storage-queries.ts` | consumes dotted storage paths |
| `core/config/attach-hooks.ts` | produces upload registry keys |
| `core/config/validate-collections.ts` | produces validation error paths |
| `core/config/validate-admin-configs.ts` | consumes admin `fields{}` keys |
| `core/patches/apply-patches.ts` | consumes patch paths |
| `admin/forms/nested-path.ts` | reads/writes bracket instance paths in form state |
| `admin/forms/repeating-items.ts` | emits stable-ID form paths with positional fallback |
| `admin/forms/upload-executor.ts` | resolves upload fields/context through bracket instance paths |

## Guard against drift

Two contract tests pin the central config/patch dialects and their storage
correspondence:

- `packages/core/src/paths/path-dialects.test.node.ts` — the config-time
  notations and cross-notation relationships, including a fixture that declares
  the same field name in two block types;
- `packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` —
  selected single-block storage shapes and the dotted elision relationship,
  from real flattener output.

Form reads/writes, stable-ID fallback, upload context resolution, and pending
upload cleanup are pinned separately in:

- `packages/admin/src/forms/nested-path.test.node.ts`;
- `packages/admin/src/forms/repeating-items.test.node.ts`;
- `packages/admin/src/forms/upload-executor.test.node.ts`;
- `packages/admin/src/forms/pending-uploads.test.node.ts`.

Search, relation, populate, and service-diagnostic contracts have their own
tests; adding another notation does not automatically surface in the two path
contract fixtures above.

## Fingerprints are a separate boundary

The runtime collection fingerprint includes data-shape components such as the
collection path, field names and selected data-shape properties, structure, and
block types. Under an unchanged collection path, changes to those included
field/structure/block-type components alter the fingerprint and normally
auto-bump the existing collection version. Changing the collection path instead
registers a different collection unless an explicit migration handles the
rename. Generated collection types carry a separate hash of generated output.
Neither hash validates path grammar, and neither includes admin override keys,
upload hook registrations, search config, or upload context declarations.
