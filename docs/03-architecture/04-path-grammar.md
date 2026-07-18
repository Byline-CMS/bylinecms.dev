---
title: "Path Grammar"
path: "path-grammar"
summary: "How Byline addresses a field. Two categories — instance paths address an item, declaration paths address a schema node — one segment AST behind both, and the rule that a block type is required in one and redundant in the other."
---

# Path Grammar

Companions:
- [Document Storage](./01-document-storage.md) — `field_path` on the `store_*` rows is the persisted instance path; that document shows real rows.
- [Fields](../04-collections/01-fields.md) — the author-facing account: which notation each config option takes.
- [Collections](../04-collections/index.md) — upload hook registry keys (`ServerConfig.hooks.uploads`) are declaration paths.
- [Blocks](../04-collections/02-blocks.md) — why per-field admin overrides inside a block come from the `blockAdmin` registry rather than a path.

Several subsystems address a field by dotted path, and they do not all mean the
same thing by it. This document is the reference for what they do mean.

## Two categories

Every field path in Byline falls into one of two categories, and the difference
is what the path addresses.

**Instance paths address a value in one item of one document.** Item selectors
are required. A block type is redundant, because the addressed item carries its
own `_type`.

```
content[1].gallery[0].alt
```

**Declaration paths address a field declaration in the schema.** There are no
item selectors. A block type is **required**, because without it two blocks
declared in the same field cannot be told apart.

```
content.photoBlock.gallery.alt
```

That single rule explains every difference between the notations below. It also
explains the defects that motivated consolidating them: an ambiguous
declaration path (one that dropped the block type) could not say which of two
`alt` declarations a validation error referred to, and an instance path
resolved *without* consulting the item's `_type` picked the wrong block and
silently dropped that field's `upload.context`.

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
| Form instance paths | `content[0].gallery[0].alt` | `[n]` | absent |

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
