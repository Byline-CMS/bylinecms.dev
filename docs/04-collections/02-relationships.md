---
title: "Relationships"
path: "relationships"
summary: "First-class typed relations: the populate pipeline, depth-bounded recursion via ReadContext, two-axis populate DSL, and the unified relation envelope across all states."
---

# Relationships

Companions:
- [Document Storage](../03-architecture/01-document-storage.md) — the foundational EAV layer relations read and write against (`store_relation` is one of the seven typed stores).
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — `@byline/client` is where most relation reads land; the populate / `WithPopulated` patterns are documented there too.
- [Collections](./index.md) — `picker` column definitions for relation-picker rows, and the `useAsTitle` field used by populate's default projection.
- [Document Paths](./04-document-paths.md) — `path` lives in a dedicated `byline_document_paths` table keyed by `(document_id, locale)`. Used by relation filters (`where: { category: { path: 'news' } }`) and locale-resolved per request.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) — populate threads `RequestContext` so `beforeRead` / `afterRead` apply to populated targets.
- [File / Media Uploads](./05-file-media-uploads.md) — the `Media` collection plus a relation pointing at it is the canonical "shared media library" pattern.
- [Rich Text](./06-rich-text.md) — document links inside richtext field values are a second consumer of the relation envelope.

## Overview

A relation in Byline is a typed reference from one document to another. Relations are first-class citizens of the storage layer (`store_relation` is one of the seven typed `store_*` tables) and a first-class field type (`RelationField`). Every relation carries the target's logical id and collection id, plus optional link metadata (`relationship_type`, `cascade_delete`).

Today's surface is intentionally focused:

- **Single or ordered multi-target.** A field stores one relation by default, or an ordered list with `hasMany: true` (see [hasMany relations](#hasmany-relations)). The `$some` / `$every` / `$none` query quantifiers for filtering by a multi-target relation are the deferred follow-up.
- **Cross-collection only.** A relation's target lives in some collection's `documentVersions`. There is no in-place "embed".
- **Read-time population.** Relations are stored as references; population happens on read, in batches, with depth-bounded recursion safety.
- **Two consumer surfaces.** A typed `RelationField` on a collection schema, *and* document links / inline images embedded inside richtext field values. Both flow through the same envelope and the same `ReadContext`.

Three things round out the picture in code:

1. **Populate** — `populateDocuments` in `packages/core/src/services/populate.ts` walks a reconstructed document's relation leaves, batch-fetches the targets, and embeds them in place.
2. **`ReadContext`** — request-scoped recursion guard (visited set, read budget, depth clamp) that survives across nested populate walks and `afterRead` hook re-entry.
3. **Relation envelope** — a single shape that every relation leaf narrows through, regardless of whether it's unpopulated, populated, unresolved, or cycle-suppressed.

The first production consumer is `News → featureImage → Media` (`apps/webapp/byline/collections/news/schema.ts`). The full pipeline — picker → patch → write → reconstruct → populate → API preview — exercises end-to-end any time an editor sets a feature image.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section.

### 1. Declare a relation field

`type: 'relation'` + `targetCollection` (the target's `path` string). `displayField` is the hint populate uses for picker rows and default projection; `optional` marks the field nullable.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
{
  name: 'category',
  label: 'Category',
  type: 'relation',
  targetCollection: 'news-categories',
  displayField: 'name',
}

{
  name: 'featureImage',
  label: 'Feature Image',
  type: 'relation',
  targetCollection: 'media',
  displayField: 'title',
  optional: true,
}
```

The picker UI, populate's default projection, and the where-clause parser all read `targetCollection` and `displayField`.

→ [Data model](#data-model)

### 2. Mark a collection as link-target for richtext

`linksInEditor: true` on the `CollectionDefinition` makes the collection's documents appear as picker options in every richtext editor's link plugin. Requires `useAsTitle` so the picker has a label.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const Pages = defineCollection({
  path: 'pages',
  useAsTitle: 'title',
  linksInEditor: true,    // ← pickable from richtext links
  fields: [/* … */],
})
```

A single boolean on the collection rather than an `allowedCollections` list per richtext field — simpler, and revisitable if a real use case ever needs per-editor restriction.

→ [Richtext document links](#richtext-document-links)

### 3. Filter on a relation target's columns

Nested-object sub-wheres compile to a depth-scoped `EXISTS` against `store_relation` joined to the target's `current_(published_)documents` view. `path` is locale-resolved; `status` is the target version's column.

**Edit:** any read call site (server fn, loader, script).

```ts
// News whose category's path is 'press'
where: { category: { path: 'press' } }

// News whose category's parent's path is 'editorial' — 2-hop
where: { category: { parent: { path: 'editorial' } } }

// Field filter on the target collection (not a top-level column)
where: { category: { slug: 'press' } }

// status / path inside a combinator are still top-level column filters
where: { $or: [{ author: { id: actor.id } }, { status: 'published' }] }
```

`status` / `path` inside a nested sub-clause resolve as document metadata at the inner depth (via `DocumentColumnFilter`), not as field filters — so a target collection that declares a `path` field will not see those clauses resolve there; rename to `slug` if that ever bites.

→ [Relation filters](#relation-filters)

### 4. Read with `populate: true` (default projection)

`populate: true` walks every relation field and applies the default projection — document-row metadata (`document_id`, `path`, `status`, `created_at`, `updated_at`) plus the schema-declared `useAsTitle` field. Depth defaults to 1 when a populate map is present.

**Edit:** any read call site.

```ts
const news = await client.collection('news').find({
  populate: true,
})
```

Cheap, predictable, no per-relation configuration.

→ [The populate pipeline](#the-populate-pipeline)

### 5. Read with `populate: '*'` (full projection, recursive)

`'*'` returns the full target document (every field), and it **propagates** — every relation reached by the walk is also fully populated, up to `depth`.

**Edit:** any read call site.

```ts
const news = await client.collection('news').find({
  populate: '*',
  depth: 3,
})
```

The right shape when you genuinely want the whole tree. For most production reads, named relations with `'*'` per-leaf is the sweet spot (recipe 6).

→ [The populate pipeline](#the-populate-pipeline)

### 6. Read named relations with per-relation projection

`populate: { name: '*' }` per relation, picked individually. This is the pattern the `news` module uses.

**Edit:** `apps/webapp/src/modules/news/list.ts` (and similar).

```ts
const news = await client.collection('news').find<NewsListFields>({
  where: data.category ? { category: { path: data.category } } : undefined,
  sort: { publishedOn: 'desc' },
  populate: { category: '*', featureImage: '*' },
  page: data.page,
  pageSize: data.pageSize,
  status: preview ? 'any' : 'published',
})
```

The per-leaf forms compose:

- `populate: { category: true }` — default projection (lighter)
- `populate: { category: '*' }` — full document at this leaf only
- `populate: { category: { select: ['name', 'path'] } }` — explicit field list
- `populate: { author: { populate: { department: true } } }` — go one level deeper

→ [The populate pipeline](#the-populate-pipeline)

### 7. Walk deeper (`depth: 2` + nested populate)

`depth: 1` is the default with a populate map; `depth: 0` disables. To walk further, raise `depth` and supply nested `populate: { … }` shapes for the deeper levels.

**Edit:** any read call site.

```ts
const news = await client.collection('news').find({
  populate: {
    featureImage: true,
    author: { populate: { department: true } },
  },
  depth: 2,
})
```

Programmatic cap is 8 (clamped by `ReadContext.maxDepth`); admin API preview cap is 3.

→ [`ReadContext` — recursion safety](#readcontext--recursion-safety)

### 8. Handle the four envelope states

Every relation leaf — pre-populate, post-populate, missing target, cycle — narrows through the same base shape. Discriminate on `_resolved` and `_cycle`.

**Edit:** any consumer rendering relation values.

```tsx
function renderRelation(rel: RelatedDocumentValue) {
  if (rel._cycle) return <span>(cycle suppressed)</span>
  if (rel._resolved === false) return <span>(deleted or hidden)</span>
  if (rel._resolved && rel.document) {
    return <a href={rel.document.path}>{rel.document.fields.title}</a>
  }
  // Raw reference — populate didn't run for this leaf.
  return <a href={`/admin/doc/${rel.target_document_id}`}>unresolved</a>
}
```

Link metadata (`relationship_type`, `cascade_delete`) survives population — it stays on the envelope after the target is attached.

→ [The relation envelope — four states, one shape](#the-relation-envelope--four-states-one-shape)

### 9. Type populated relations with `WithPopulated`

Schema-derived field types treat relation slots as the unpopulated wire shape (`RelatedDocumentValue`). `WithPopulated<Fields, 'name', TargetFields>` overlays the populated envelope so `result.fields.<name>?.document?.fields.<field>` is fully typed.

**Edit:** the server-fn that calls populate.

```ts
import type { WithPopulated } from '@byline/client'
import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

await client.collection('news').find<NewsListFields>({
  populate: { category: '*', featureImage: '*' },
})
```

The wrapper is purely at the type level — a matching `populate: { … }` at the call site is still required for the runtime envelope to actually be populated.

→ [Client SDK — Typing populated relations](../05-reading-and-delivery/01-client-sdk.md#typing-populated-relations)

### 10. Status awareness through populate

Populate honours the same `readMode` rule as direct reads. A public reader (`@byline/client`, defaulting to `readMode: 'published'`) sees populated targets through `current_published_documents` — a draft over a previously-published target *does not* leak through populate. Admin code paths use `readMode: 'any'` and see the latest version regardless of status.

**Edit:** the server-fn (the status / preview gate is per call).

```ts
// Public read — populated targets pass through current_published_documents
await client.collection('news').find({
  populate: { featureImage: '*' },
  status: 'published',   // default; explicit here for clarity
})

// Admin read or preview — see latest regardless of publish state
await client.collection('news').find({
  populate: { featureImage: '*' },
  status: 'any',
})
```

This applies through every depth level — a populated target is itself read through the same source view as the calling document.

→ [Status awareness through populate](#status-awareness-through-populate)

### 11. Thread `ReadContext` through a custom `afterRead` hook

`afterRead` hooks that perform their own reads must thread the existing `readContext` through. Otherwise: re-reads cost a fresh DB round-trip, the cycle guard breaks, and `afterRead` may fire twice on the same document in one request.

**Edit:** the hook in your collection's schema.

```ts
import { defineCollection } from '@byline/core'

export const Posts = defineCollection({
  path: 'posts',
  hooks: {
    afterRead: async ({ doc, requestContext, readContext, client }) => {
      // Hook reads another doc — thread `readContext` through:
      const related = await client.collection('media').findById(
        doc.fields.featureImageId,
        { _readContext: readContext }   // ← preserves visited set + read budget
      )
      doc.fields.featureImage = related
    },
  },
  fields: [/* … */],
})
```

`ReadContext` carries the visited set, the `afterReadFired` set, the read budget, and the depth clamp. Threading it preserves "each document materialises at most once per logical request."

→ [`ReadContext` — recursion safety](#readcontext--recursion-safety)

---

## Architecture

### Data model

**`RelationField` schema:**

```ts
{
  name: 'featureImage',
  label: 'Feature Image',
  type: 'relation',
  targetCollection: 'media',     // path of the target collection
  displayField: 'title',         // optional; falls back to first text field
  optional: true,
}
```

`targetCollection` is the source-of-truth string the picker, populate, and the where-clause parser all consult. `displayField` is a hint for picker rows and populate's default projection — populate always includes it implicitly so widget summaries keep working even if a caller's `select` doesn't ask for it.

**Storage row.** `store_relation` has the same row identity as the other store tables (`document_version_id`, `locale`, `path`) plus the relation-specific columns:

```sql
store_relation
  document_version_id   uuid
  locale                text
  path                  text                -- e.g. 'featureImage', 'content.0.body.0.relatedDoc'
  target_document_id    uuid                -- the relation's target
  target_collection_id  uuid                -- the target's collection (DB UUID)
  relationship_type     text                -- nullable; opaque to core
  cascade_delete        boolean             -- nullable; not yet acted on
```

The flatten/reconstruct pipeline in `packages/db-postgres/src/modules/storage/storage-utils.ts` round-trips the reference shape: a `RelationField`'s value at write time is `{ target_document_id, target_collection_id, relationship_type?, cascade_delete? }`, and that's exactly what's reconstructed on read before populate runs.

### The relation envelope — four states, one shape

Every relation leaf — pre-populate, post-populate, missing target, cycle — narrows through the same base shape (`RelatedDocumentValue`). The discriminators `_resolved` / `_cycle` / `document` identify which of the four states the leaf is in:

```ts
// Unpopulated — no populate pass ran, or this leaf wasn't in scope
{ target_document_id, target_collection_id, relationship_type?, cascade_delete? }

// Populated — target fetched and attached
{ ..., _resolved: true, document: { ...fetched target } }

// Unresolved — target not found (deleted, soft-deleted, or filtered out)
{ ..., _resolved: false }

// Cycle — target already materialised earlier in this request
{ ..., _resolved: true, _cycle: true }
```

Two rules fall out of this shape:

- **Same narrowing logic everywhere.** `if (v._cycle) { … } else if (v._resolved === false) { … } else if (v._resolved && v.document) { … } else { /* raw ref */ }` works at every relation leaf, no matter where it sits in the document tree.
- **Link metadata survives population.** `relationship_type` and `cascade_delete` stay on the envelope after the target is attached — not thrown away on success.

The unresolved-target shape and the cycle shape stay distinct so callers can tell "not fetched because deleted" from "not fetched because of cycle" — the failure mode and the recovery affordance are different.

### The populate pipeline

```ts
// packages/core/src/services/populate.ts
export async function populateDocuments(opts: {
  db: IDbAdapter
  collections: CollectionDefinition[]
  collectionId: string                    // source collection
  documents: Array<Record<string, any>>
  populate?: PopulateMap | true | '*'
  depth?: number                          // default 1 when populate is set; 0 disables
  locale?: string
  readMode?: 'published' | 'any'
  readContext?: ReadContext               // request-scoped guard
  requestContext?: RequestContext         // for beforeRead / afterRead
}): Promise<void>
```

Mutates `documents` in place. `find*` results are freshly-shaped copies, so this never aliases storage state.

**Algorithm — batch-by-depth.** For every depth level:

1. **Walk** each document's `fields` against its `CollectionDefinition`, recursing through `group` / `array` / `blocks` to collect every relation leaf that matches the populate map.
2. **Group** the collected leaves by `target_collection_id`.
3. **Batch fetch** each group via `IDocumentQueries.getDocumentsByDocumentIds()` — *one DB round-trip per target collection per depth level*. Selective field loading is wired through this call, so the batch projects only the fields the populate map asked for (plus the target's `displayField`).
4. **Replace** each leaf in place with the populated, unresolved, or cycle-marked envelope.
5. **Recurse** to the next depth if `depth > 1`, using the populate map's nested `populate: { ... }` as the next level's spec.

The batch-per-target-collection-per-depth shape is what keeps populate cheap. A 20-document × 3-relation × 2-depth fan-out is six total DB round-trips, not 120 — see the [storage benchmark](../03-architecture/01-document-storage.md#indicative-benchmarks) where `populateDocuments` depth-2 stays flat at ~3 ms across all scales.

**The populate DSL — two axes.** Populate options compose two orthogonal axes: **scope** (which relations to walk) and **projection** (what fields to return per target).

```ts
// Scope at the top level:
populate: true                       // every relation field, default projection
populate: '*'                        // every relation field, full projection, recursive
populate: { featureImage: ... }      // named relations only

// Projection at each leaf:
populate: { featureImage: true }                              // default projection
populate: { featureImage: '*' }                               // full document, propagates
populate: { featureImage: { select: ['title', 'altText'] } }  // explicit
populate: { author: { populate: { department: true } } }      // deeper level
```

The **default projection** is the document row metadata that's always free (`document_id`, `path`, `status`, `created_at`, `updated_at`) plus the schema-declared `useAsTitle` field (fallback: first text field). `'*'` wins when any leaf in a batch requests it — projection composes across leaves of the same target collection.

**`useAsTitle` lives on `CollectionDefinition`.** The default projection is **schema-aware without a UI dependency**. `useAsTitle` was deliberately placed on `CollectionDefinition` (server-safe) rather than on `CollectionAdminConfig` (admin-only) so populate, `afterRead` consumers, and any future access-control consumer can read a document's identity without taking a UI runtime dependency. Django's `Model.__str__` is the analogue.

`CollectionAdminConfig` retains a separate `picker?: ColumnDefinition[]` slot that drives rich row rendering in the relation-picker modal (e.g. thumbnail + title + status for Media). It's distinct from `columns` (which drives list-view rendering); formatters are reusable across both. See [Collections § Columns and picker](./index.md#columns-and-picker).

### Status awareness through populate

Populate honours the same `readMode` rule as direct reads. When a public reader (`@byline/client`, defaulting to `readMode: 'published'`) populates a relation, the target is fetched through `current_published_documents` — so a draft over a previously-published target *does not* leak through populate. Admin code paths use `readMode: 'any'` (the adapter default) and see the latest version regardless of status. See Quick Reference recipe 10 for the call-site idiom.

### `ReadContext` — recursion safety

A populate walk that ignored the rest of the request would still cycle the moment `afterRead` started doing its own reads. Byline's response is a **request-scoped `ReadContext`** that survives across nested populate walks and across `afterRead` re-entry.

```ts
export interface ReadContext {
  visited: Set<string>          // ${target_collection_id}:${document_id} keys
  readCount: number             // monotonic; throws ERR_READ_BUDGET_EXCEEDED on overflow
  maxReads: number              // default 500
  maxDepth: number              // default 8 (caps `depth`)
  afterReadFired: Set<string>   // each doc runs through afterRead at most once per request
  beforeReadCache: ...          // beforeRead predicate cache, see Authentication & Authorization
}

export function createReadContext(overrides?: Partial<ReadContext>): ReadContext
```

**Three enforcement points:**

1. **Populate walk.** Each populate level pre-filters target IDs against `visited`. Already-visited IDs become the `_cycle: true` stub instead of a re-fetch. Keys are `${collection_id}:${document_id}` so two collections that somehow shared a UUID stay distinct.
2. **Read budget.** Each materialised document increments `readCount`. Crossing `maxReads` throws `ERR_READ_BUDGET_EXCEEDED` carrying the partial result so the caller can decide whether to surface or degrade. Cheap defensive insurance against a malformed graph or a buggy hook.
3. **`afterRead` once-per-doc-per-request.** `afterReadFired: Set<string>` enforces "each document runs through `afterRead` at most once per logical request." A hook re-reading a doc that's already in `visited` short-circuits with the cached materialised value — no second pass, no second hook fire. The single most important semantic rule, and the reason `ReadContext` was wired ahead of the hook rather than retrofitted.

**Threading rules:**

- **Top-level reads create a fresh `ReadContext`.** External callers never see it — public signatures stay context-free.
- **`CollectionHandle` accepts a private `_readContext?` opt-in** for hook re-entry. Hooks that call `client.collection(...).find(...)` thread the same context through; subsequent reads of an already-visited document are short-circuited.
- **Populate and `afterRead` always share one context per request.** A document linked through both a relation field and a richtext document link would otherwise cost two materialisations and two hook fires; sharing the context collapses them to one.

`AsyncLocalStorage` is a future option for carrying `ReadContext` implicitly. The explicit parameter is the source of truth today; `AsyncLocalStorage` can layer over it later without breaking the contract.

### Relation filters

Relations are queryable. The `where` clause supports nested-object sub-wheres against a relation field's target — see Quick Reference recipe 3 for the call-site shape.

The compiler in `packages/core/src/query/parse-where.ts` recognises nested-object sub-wheres on relation fields and emits `RelationFilter` entries with recursive `nested: DocumentFilter[]`. The Postgres adapter's `buildFilterExists` dispatches on filter `kind` and emits a depth-scoped nested EXISTS through `store_relation` joined to the target's `current(_published)_documents` view.

Two consequences worth flagging:

- **`readMode` propagates through the filter predicate.** A public-reader query for `where: { author: { id: 'X' } }` only matches when there is a *published* version of the author — no draft leaks at the target side either.
- **Nested-object DSL was chosen over Payload-style dot notation** (`'author.id': 'X'`). Dot notation collides with Byline's internal EAV path notation and doesn't absorb the future `hasMany` quantifiers (`some`, `every`, `none`).

### The relation field admin widget

Editing a relation field uses the components in `packages/admin/src/fields/relation/`:

- **`relation-field.tsx`** — the single-relation in-form widget. Renders a compact summary card via `RelationSummary` when set, plus Remove and Change buttons. When empty, renders a "Select…" button.
- **`relation-many-field.tsx`** — the `hasMany` widget. A drag-reorderable list of `RelationSummary` tiles with per-tile remove and an "Add" button that appends through the picker.
- **`relation-picker.tsx`** — the modal that opens on Select / Change / Add. Lists documents from the `targetCollection` via the host's `getCollectionDocuments` server fn, with search and pagination.
- **`relation-column-formatter.tsx`** — renders a relation cell in list views as the target's `useAsTitle` (single) or "A, B, +N more" (`hasMany`).

Selection flows through the standard `setFieldValue` → `FieldSetPatch` pipeline — no new patch family. The patch contract is `field.set` with `value = { target_document_id, target_collection_id }`; `field.clear` on Remove. Both already supported by `setFieldValue`.

**Display-field resolution** inside the picker: `field.displayField` → first top-level `text` field on the resolved target definition → `path` → `document_id`.

**Failure mode for an unknown target collection:** if the target collection isn't registered, the widget renders an inline error ("Relation field `{name}` targets unknown collection `{targetCollection}`") and a disabled picker button. No throw.

The Zod schema builder emits a typed object for relation fields:

```ts
z.object({
  target_document_id: z.string().uuid(),
  target_collection_id: z.string().uuid(),
  relationship_type: z.string().optional(),
  cascade_delete: z.boolean().optional(),
}).nullable()
```

The old `z.any()` catch-all is gone — the picker's contract is enforced at form-validate time.

### Richtext document links

A second application of the relationship primitive: links to other Byline documents *inside* a richtext field value, plus inline-image references to media documents. Two paired Lexical plugins consume the same `DocumentRelation` envelope this doc defines.

The full present-state strategy — how the link and inline-image modals embed picked targets at picker time, the on-save server walker that canonicalises `document.path` via `CollectionDefinition.buildDocumentPath`, the persisted Lexical JSON shapes, the `embedRelationsOnSave` / `populateRelationsOnRead` field-level flags, and the embed / populate adapter contracts — lives in **[Rich Text → Relations — embed and populate](./06-rich-text.md#relations--embed-and-populate)**.

One eligibility flag stays here because it lives on `CollectionDefinition`, not on the editor adapter:

```ts
export const Pages: CollectionDefinition = {
  path: 'pages',
  linksInEditor: true,                 // ← this collection is pickable from richtext
  fields: [...],
}
```

A collection becomes pickable from *every* richtext editor's link picker when its definition declares `linksInEditor: true`. Deliberately a single boolean on the collection rather than an `allowedCollections` list per richtext field — simpler, and revisitable if a real use case ever needs per-editor restriction.

### Admin API preview depth selector

The admin "API" view at `apps/webapp/src/routes/(byline)/admin/collections/$collection/$id/api.tsx` ships a depth selector (0–3) in the ViewMenu. Changing it threads `?depth=N` through `loaderDeps`, so each depth is a distinct cache entry. The user-facing cap is **3** — strict enough to prevent a curious editor from accidentally DOSing the preview on a wide graph; the programmatic client cap is **8** (`ReadContext.maxDepth`).

The admin server fn (`packages/host-tanstack-start/src/server-fns/collections/get.ts`) calls `populateDocuments` directly through `@byline/core/services` rather than through `@byline/client` — admin code paths historically did not depend on the client SDK at runtime. (Admin reads now flow through `CollectionHandle` for the `beforeRead` track; the populate-direct call sits inside `CollectionHandle.findById` on that path.)

### Demo wiring — News → Media

The first production relation is in the News collection (`apps/webapp/byline/collections/news/schema.ts`):

```ts
{
  name: 'featureImage',
  label: 'Feature Image',
  type: 'relation',
  targetCollection: 'media',
  displayField: 'title',
  optional: true,
}
```

…and the seeded News documents in `apps/webapp/byline/seeds/documents.ts` reference existing Media items. Editing a news item shows the picker; saving writes through the standard form-state pipeline; reloading the API preview at depth 1 shows the populated Media envelope (including the file's `variants` array — see [File / Media Uploads](./05-file-media-uploads.md)); depth 2 walks into Media's own field set; deleting the referenced Media item and reloading at depth 1 shows the `_resolved: false` placeholder rather than a crash.

---

## `hasMany` relations

A relation field with `hasMany: true` holds an **ordered list** of target
references instead of a single one (with optional `minItems` / `maxItems`):

```ts
{ name: 'authors', type: 'relation', targetCollection: 'people', hasMany: true }
```

It is modelled as an array of relation values: each item flattens to its own
`store_relation` row at an indexed path (`authors.0`, `authors.1`, …) and
reconstructs in order — no new storage column or migration (the
`unique(version, field_path, locale)` constraint already permits it since each
index is a distinct path). `populate` resolves **each** element into its own
envelope, yielding an ordered array of populated values; a deleted target
surfaces as a `_resolved: false` slot in place rather than collapsing the array.
The editor renders a drag-reorderable list of summary tiles (the same
`RelationSummary` the single field uses) with a per-tile remove and an "Add"
button that appends through the standard picker (`packages/admin/src/fields/relation/relation-many-field.tsx`).
Items are identified by `targetDocumentId` (a target may appear at most once);
each edit writes the whole array back as a coalesced `field.set` patch. See
`apps/webapp/byline/collections/pages/schema.ts` (`gallery`) for a reference field.
Use `WithPopulatedMany<F, K, Target>` (`@byline/client`) to type the populated
array shape.

## Current limitations

- **No `where` quantifiers for `hasMany` yet.** Filtering a query by a
  multi-target relation (`$some` / `$every` / `$none`) is the deferred
  fast-follow; reading and populating ordered lists works today.
- **`cascadeDelete` is recorded but not enforced.** The flag round-trips through
  storage; deleting a target does not yet act on it. A deleted target surfaces as
  an unresolved relation envelope (`_resolved: false`) on read.

## Code map

| Concern | Location |
|---|---|
| `RelationField` schema type | `packages/core/src/@types/field-types.ts` |
| `RelatedDocumentValue` envelope | `packages/core/src/@types/field-data-types.ts` |
| `WithPopulated` type helper | `packages/client/src/types.ts` |
| `populateDocuments` service | `packages/core/src/services/populate.ts` |
| `walkRelationLeaves` walker | `packages/core/src/services/populate.ts` |
| `ReadContext` + `createReadContext` | `packages/core/src/services/populate.ts` |
| Field-type → store-table mapping | `packages/core/src/storage/field-store-map.ts` |
| Relation `WhereClause` compilation | `packages/core/src/query/parse-where.ts` (`RelationFilter` branch) |
| Postgres `RelationFilter` SQL | `packages/db-postgres/src/modules/storage/build-filter-exists.ts` |
| `store_relation` schema | `packages/db-postgres/src/database/schema/index.ts` |
| Zod schema for relation | `packages/core/src/schemas/zod/builder.ts` |
| Relation field admin widgets | `packages/admin/src/fields/relation/{relation-field,relation-many-field,relation-picker,relation-summary,relation-display,relation-column-formatter}.tsx` |
| `itemView` / `picker` resolver | `packages/core/src/config/config.ts` (`resolveItemViewColumns`) |
| Admin API preview depth selector | `apps/webapp/src/routes/(byline)/admin/collections/$collection/$id/api.tsx` |
| Admin `getDocument` server fn | `packages/host-tanstack-start/src/server-fns/collections/get.ts` |
| `linksInEditor` flag | `packages/core/src/@types/collection-types.ts` (`CollectionDefinition.linksInEditor`) |
| Richtext document links + embed / populate strategy | [Rich Text → Relations — embed and populate](./06-rich-text.md#relations--embed-and-populate) |
| Reference relation field | `apps/webapp/byline/collections/news/schema.ts` (`featureImage` field) |
| Reference list reading populated relations | `apps/webapp/src/modules/news/list.ts` |
| Reference detail reading populated relations | `apps/webapp/src/modules/news/detail.ts` |
| Integration tests | `packages/client/tests/integration/{client-populate-status,client-multi-relation}.integration.test.ts` |
