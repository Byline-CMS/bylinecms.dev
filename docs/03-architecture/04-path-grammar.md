---
title: "Path Grammar"
path: "path-grammar"
summary: "How Byline addresses a field, and why an EAV store needs it to. Two categories — instance paths address a value in a document, declaration paths address a node in the schema — one segment AST behind both, and the rule governing when a block type must be written down."
---

# Path Grammar

Companions:
- [Document Storage](./01-document-storage.md) — `field_path` on the `store_*` rows is the persisted instance path; that document shows real rows.
- [Fields](../04-collections/01-fields.md) — the author-facing account: which notation each config option takes.
- [Collections](../04-collections/index.md) — upload hook registry keys (`ServerConfig.hooks.uploads`) are declaration paths.
- [Blocks](../04-collections/02-blocks.md) — why per-field admin overrides inside a block come from the `blockAdmin` registry rather than a path.

## Why a field has an address at all

Byline does not store a document as a JSON blob. Every value in a document is
its own row in a typed store table — `store_text`, `store_numeric`,
`store_file`, and the rest — picked by the field's type. That is what makes a
document queryable, diffable and versionable one field at a time instead of one
document at a time. [Document Storage](./01-document-storage.md) covers the
reasoning; this document covers the consequence.

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

That record is a field path. It is a string, it lives in the `field_path`
column, and it is the reason a row knows it holds the alt text of the first
image in the gallery of the photo block at position 1 — rather than just
holding the string `"Sunrise over the bay"`.

## The same question, four times over

Storage is where paths start, but it is not where they stop. Four different
parts of Byline need to point at a field, and it is worth seeing them together
before the notations, because their differences are not arbitrary.

**Taking a document apart, and putting it back.** The flattener emits one path
per value on the way in; the reconstructor reads those paths back into nested
shape on the way out. The round trip has to be lossless — a path that cannot
express "inside this block variant" is a document that comes back wrong.

**Editing one field without rewriting the document.** When you change a caption
in the admin UI, the editor does not send the whole document back. It sends a
patch that names what changed:

```
content[id=01924f…].gallery[id=01924g…].alt
```

Addressing items by stable id rather than position is what lets that patch stay
correct even if someone reorders the gallery in the meantime. The same
machinery is the foundation for collaborative editing later.

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
every difference between the notations that follow.

## Two categories

Every field path in Byline falls into one of two categories, and the difference
is what the path addresses.

**Instance paths address a value in one item of one document.** Item selectors
are required. A block type is redundant wherever the item itself is in reach,
because it carries its own `_type` — with one exception, storage, for the
reason given below.

```
content[1].gallery[0].alt
```

**Declaration paths address a field declaration in the schema.** There are no
item selectors. A block type is **required**, because without it two blocks
declared in the same field cannot be told apart.

```
content.photoBlock.gallery.alt
```

Both defects that motivated consolidating these notations were failures of that
rule. An ambiguous declaration path — one that dropped the block type — could
not say which of two `alt` declarations a validation error referred to. And an
instance path resolved *without* consulting the item's `_type` picked the wrong
block, silently dropping that field's `upload.context`. Neither was a parsing
bug; both were a path being read as if it belonged to the other category.

### The two are one grammar

Take a storage path and remove its item selectors:

```
content.0.photoBlock.gallery.0.alt   →   content.photoBlock.gallery.alt
```

The result is exactly the upload hook registry's declaration path for that
field. The two notations are the same grammar differing only in whether
selectors are present — which is why one segment list can serialise as either.
A test derives this from real flattener output rather than asserting it
(`packages/db-postgres/src/modules/storage/storage-paths.test.node.ts`).

### Storage carries both, and has to

Storage `field_path` is the exception to "a block type is redundant in an
instance path", and the exception is instructive. It carries selectors *and*
the block type — `content.0.photoBlock.gallery.0.alt` — where a patch path for
the same value carries only selectors.

The difference is what else is in reach at the moment the path is read. In
memory, resolving `content[0].alt` means the item is right there and can be
asked its `_type`. In the database it cannot: `_type` lives in a **different
row**, in `store_meta`. A row addressed `content.0.alt` would need a join
against its siblings before anyone could say which block's `alt` it holds. The
block type in the path is what makes a stored row self-describing — and what
lets a query filter by block type without a join.

It is also what makes the elision above work. Strip the selectors from
`content.0.photoBlock.gallery.0.alt` and a valid declaration path falls out.
Strip them from a hypothetical `content.0.gallery.0.alt` and you get
`content.gallery.alt`, which resolves to nothing, because the discriminator was
never written down. The elision test guards exactly this.

## The notations

Target field throughout: `alt`, inside array `gallery`, inside block
`photoBlock`, inside blocks field `content`, in collection `pages`.

| Notation | For that field | Selectors | Block type |
|---|---|---|---|
| Storage `field_path` | `content.0.photoBlock.gallery.0.alt` | `.n` positional | after the index |
| Upload hook registry | `pages.content.photoBlock.gallery.alt` | none | required, collection-prefixed |
| Boot-validation errors | `content.photoBlock.gallery.alt` | none | required |
| Admin `fields{}` keys | *unreachable — see below* | rejected | rejected |
| Patch paths | `content[id=…].gallery[id=…].alt` | `[n]` or `[id=…]` | absent |
| Form instance paths | `content[0].gallery[0].alt` | `[n]` or `[id=…]` | absent |

The last two rows are one notation, not two. Both parse through
`parseInstancePath` and both accept either selector form; the examples differ
only in what each site typically *emits*. Patches prefer `[id=…]` because a
patch outlives the reorder that would invalidate a position, while form paths
are positional because they address the item currently rendered at that index.

Two further dotted notations exist and are deliberately **not** field paths:

- `UploadConfig.context` (`../caption`, `/title`) is a *relative* addressing
  language layered on top of an instance path, resolved filesystem-style
  against the upload field's containing scope.
- The counter allocator's previous-value lookup walks a data object and stops
  at any array. Counters cannot be declared inside `array` / `blocks`, so it
  needs neither selectors nor block types.

## The shared module

`packages/core/src/paths/` is the single implementation. One segment AST backs
both serialisations:

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
| `toDeclarationSegments` | Drop selectors — the instance → declaration projection. |
| `resolveDeclarationPath` | Resolve against a field set; `blocks: 'qualified' \| 'forbidden'`. |
| `walkFieldDeclarations` | The canonical schema walk, with an `onBlock` callback. |

### Parsing cannot classify a block type

A block type and a field name are both bare identifiers, so **parsing is
schema-unaware**: `parseDeclarationPath` returns only `field` segments.
`resolveDeclarationPath` reclassifies them against a field set and returns
correctly typed segments the parser could not have produced.

Producers are the other way round. A caller walking a schema already knows
which is which, so `walkFieldDeclarations` emits `blockType` segments directly.
Everything that produces a declaration path should use it rather than
re-implementing the descent — four independent descents had drifted apart
before it existed.

`onBlock` exists because a block declaring no fields is invisible to a
field visitor, and validation that must see every block (the dot-free check on
block types, for one) would silently stop covering those.

### Projection is done over segments, not text

`toDeclarationSegments` filters a typed list. The equivalent regex over raw
text — `/^\d+$/` against each dot-separated part — deletes a field legitimately
named `0`. Working over segments cannot, because `0` there is a `field`.

## What is frozen

**Storage `field_path` is persisted data.** Changing that grammar is a
migration, not a refactor. It is documented here and pinned by tests; it is not
a candidate for change.

**Patch paths are a wire format.** `parsePatchPath` delegates to
`parseInstancePath` — the two agree on every well-formed path — but the segment
shape it returns (`key` rather than `name`) is preserved for its consumers. A
malformed path yields no segments, so the patch is rejected rather than applied
at a truncated path.

## The one deliberate narrowing

Admin `fields{}` override keys are declaration paths with block traversal
**barred entirely**, even when correctly qualified. Fields inside a block take
their overrides from the blockType-keyed `blockAdmin` registry instead, so one
registration applies wherever that block renders — in any collection, at any
nesting depth. Boot validation rejects a collection-level key that reaches into
a block and points the author at `blockAdmin`.

What is barred is *traversal*. A key naming the blocks field itself —
`content`, not `content.photoBlock.gallery.alt` — resolves normally, because
that field carries a label and a description like any other and overriding it
says nothing about the blocks inside it.

This is expressed as `resolveDeclarationPath(fields, key, { blocks: 'forbidden' })`
— a policy on the shared resolver, not a second grammar.

## Where each notation lives

| Site | Role |
|---|---|
| `db-postgres/…/storage-flatten.ts` | produces storage paths |
| `db-postgres/…/storage-restore.ts`, `storage-queries.ts` | consumes storage paths |
| `core/config/attach-hooks.ts` | produces upload registry keys |
| `core/config/validate-collections.ts` | produces validation error paths |
| `core/config/validate-admin-configs.ts` | consumes admin `fields{}` keys |
| `core/patches/apply-patches.ts` | consumes patch paths |
| `admin/forms/upload-executor.ts` | consumes instance paths; resolves uploads through blocks |

## Guard against drift

Two contract tests pin every notation against one fixture that declares the
same field name in two block types — the collision an unqualified path cannot
resolve:

- `packages/core/src/paths/path-dialects.test.node.ts` — the config-time
  notations and the cross-notation relationships.
- `packages/db-postgres/src/modules/storage/storage-paths.test.node.ts` — the
  storage notation and the elision relationship, from real flattener output.

A new notation, or a change to an existing one, surfaces there. This is the
same guard-rail pattern as the field → store mapping's contract test.
