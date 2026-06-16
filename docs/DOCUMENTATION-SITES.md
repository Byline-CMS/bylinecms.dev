---
title: "Documentation Sites"
path: "documentation-sites"
summary: "A usage-scenario guide for building hierarchical documentation / book sites on Byline — choosing relationship direction (parent-up vs. children-down), the authoring tree view, and the read-side navigation surface (breadcrumbs, prev/next, On This Page) built entirely on native field-relation primitives."
---

# Documentation Sites

This is a **scenario guide**, not a subsystem reference. It shows how to assemble
Byline's existing primitives into a hierarchical documentation or book site —
ordered top-level subjects/chapters, nested leaf topics, and the read-side
navigation chrome (breadcrumbs, previous/next, "On This Page") that readers
expect. It makes no new platform demands: everything here is built on shipped
field relations, `orderable` collections, and a custom list view.

Companions:
- [RELATIONSHIPS.md](./RELATIONSHIPS.md) — the relation primitive every model here is built on: the `store_relation` table, the populate pipeline, the relation envelope, relation `where`-filters, and the planned `hasMany` phase.
- [COLLECTIONS.md](./COLLECTIONS.md) — `orderable: true` (the fractional-index `order_key` that drives drag-to-reorder), custom list views via `defineAdmin({ listView })`, and the schema-vs-presentation split.
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — `useAsPath` / the `byline_document_paths` table; each node's canonical URL slug, used by breadcrumbs and prev/next link targets.
- [MARKDOWN-EXPORT.md](./MARKDOWN-EXPORT.md) — heading structure in the serialized content, which the client-side "On This Page" widget reads.

## Overview

A documentation site is, structurally, a **tree with a single canonical spine**:
chapters/subjects in a defined order, each owning an ordered list of leaf
topics. Readers navigate that spine linearly (previous/next) and contextually
(breadcrumbs), and a typical third level — the headings *within* a page — is
provided client-side from the rendered content, not from the CMS.

Two facts anchor every decision in this guide:

1. **Build on field relations, not a bespoke hierarchy table.** Byline's
   relation pipeline (`store_relation` + populate + envelope + `where`-filters +
   the picker UI) is the load-bearing relationship primitive. Any hierarchy
   model here reuses it wholesale rather than standing up a parallel subsystem.
2. **A navigable docs site needs one canonical parent per node.** Breadcrumbs
   and previous/next require a single, unambiguous path to each page. A node that
   genuinely belongs in two places is expressed as a *cross-link* (an ordinary
   relation field — "See also"), **not** as true multi-parenting. Multi-parent
   graphs have no single breadcrumb trail and no single "next page," so they are
   the wrong shape for this surface even where the data layer could express them.

---

## Two models, one trade

The real choice is **which document owns the structure** — and therefore **which
document is versioned when the structure changes.** Depth is the tiebreaker, but
the axis is ownership and versioning grain.

### Model A — parent-up (each child declares its single parent)

A single-target `parent` relation on every node points at its parent. Root nodes
have no parent. Sibling order comes from `orderable: true` (`order_key`).

```ts
// apps/webapp/byline/collections/docs/schema.ts
export const Docs = defineCollection({
  path: 'docs',
  useAsTitle: 'title',
  useAsPath: 'title',
  orderable: true,                 // sibling ordering via order_key
  fields: [
    { name: 'title', type: 'text' },
    { name: 'body', type: 'richText' },
    {
      name: 'parent',
      label: 'Parent',
      type: 'relation',
      targetCollection: 'docs',    // self-referential
      displayField: 'title',
      optional: true,              // null = root node
    },
    // Optional secondary placements / "See also" — cross-links, not parents:
    // { name: 'relatedDocs', type: 'relation', targetCollection: 'docs', /* hasMany when shipped */ },
  ],
})
```

- **Self-similar at every depth.** Every node is the same shape, so n-levels is
  uniform rather than compounding.
- **Structure is versioned into the moved node.** Re-parenting a topic mints a
  new version of *that topic*, never of its parent.
- **Navigation is native.** Breadcrumbs walk the `parent` relation upward;
  prev/next flatten the tree. Both are upward / spine-shaped traversals — exactly
  what this model is built for (see [Read-side navigation](#read-side-navigation)).
- **Buildable today.** Single-target relations, `orderable`, relation
  `where`-filters, and iterative populate are all shipped.

**Cost:** sibling ordering is not intrinsically per-parent. `order_key` is a
**single sequence per collection** (`idx_documents_collection_order` is on
`(collection_id, order_key)`), not partitioned by parent. This is a non-issue in
practice — see [Ordering on a global key](#ordering-on-a-global-key) — but it is
the model's one rough edge.

### Model B — children-down (parent owns an ordered list of children)

A `hasMany` relation (`children`) on the parent holds the ordered child list.
Child order is the array position. Root order via `orderable: true`.

```ts
{
  name: 'children',
  label: 'Topics',
  type: 'relation',
  targetCollection: 'docs',
  displayField: 'title',
  // hasMany: true,   // ← the children array (see RELATIONSHIPS.md → Phase — hasMany)
}
```

- **Child order is free and per-parent** — it is literally the array index in the
  parent's field value.
- **Structure is versioned content of the parent.** Adding/moving a child drafts
  the parent and rides its publish workflow. For a docs site this is often
  desirable (you can roll back a restructure), occasionally friction (you must
  republish a chapter to reveal a new topic).
- **Clean at two levels; compounds when nested.** Each additional level is a
  *different document's* versioned field, so editing and tree-building grow more
  involved per level.
- **Gated on the `hasMany` phase**, which is planned but not yet shipped (see
  [RELATIONSHIPS.md → Phase — `hasMany` relations](./RELATIONSHIPS.md#phase--hasmany-relations)).

### Choosing

| If… | Use | Why |
|---|---|---|
| Genuinely two levels (book → chapters, subject → topics), authoring ergonomics dominate | **B (children-down)** | Per-parent child order is free; the parent-owns-an-ordered-list mental model matches the editor. |
| Arbitrary / growing depth | **A (parent-up)** | Self-similar recursion; moving a node versions only that node. |
| You need breadcrumbs + prev/next (i.e. any real docs site) | **A (parent-up)** | The navigation surface is upward / spine-shaped — native to a parent pointer. See below. |
| You want to ship on shipped primitives now | **A (parent-up)** | No dependency on the `hasMany` phase. |

**Rule of thumb:** the authoring tree-view alone favours B at two levels; the
moment you add the reader-facing navigation surface (breadcrumbs especially) the
upward-traversal workload pulls toward **A**, even at shallow depth. For a docs
site, default to **A** unless you are firmly two-level and the parent-owns-the-list
authoring model is worth the dependency on `hasMany`.

> **Don't stack `hasMany` for depth.** Carrying deep nesting by chaining a
> children array level after level is where Model B's compounding bites. If you
> expect to go past two levels, start with Model A — retrofitting direction later
> is the expensive migration, because it moves where every structural edge is
> stored.

### Why not a multi-parent hierarchy table

The one capability a dedicated many-to-many hierarchy table would add over a
single `parent` pointer is *a child with more than one parent*. We deliberately
don't build on that, for two reasons:

1. **Native relations already express multi-parent** — either downward (several
   parents list the same child) or upward (`parents` as a `hasMany`). A bespoke
   join table adds no capability the relation pipeline lacks; it only forces a
   second relationship subsystem (its own populate, envelope, `where`, picker).
2. **Multi-parenting is the wrong shape for navigation.** Breadcrumbs and
   prev/next need a single canonical spine; a node with two parents has two
   trails and two "next" pages. You end up designating a canonical parent anyway
   and expressing the second home as a cross-link. So the multi-parent "superpower"
   does not survive contact with the navigation UX.

The clean model is therefore **a canonical tree** (single parent) **plus ordinary
cross-link relation fields** (`relatedDocs`, "See also") for multi-home cases.

---

## Authoring: the hierarchy tree view

Replace the default table list view with a custom tree view via
`defineAdmin({ listView })`. This is a first-class seam — the `MediaListView`
(`apps/webapp/byline/collections/media/components/media-list-view.tsx`) is the
working precedent for "throw away the table, render anything," and a custom
`listView` receives `ListViewComponentProps` and owns its own data fetch, search,
ordering, and pagination.

### Build the tree in memory

Documentation sites are small by nature — typically a few dozen chapters, rarely
more. Fetch the whole set and build the tree client-side:

```ts
// In the custom list view's own loader / fetch — do NOT rely on the injected
// paginated `data` prop, which is single-collection and does not populate
// relations. Read explicitly instead:
const all = await client.collection('docs').find({
  populate: { parent: true },     // Model A — or { children: true } for Model B
  sort: { orderKey: 'asc' },
  status: 'any',
  pageSize: 500,                  // the whole tree; a docs site is small by design
})
```

Then group by `parent` (Model A) or walk `children` (Model B), sort each sibling
set by `order_key`, and render indented with collapse/expand per node. For ~50–60
parents plus their children the in-memory pass is trivial.

### Drag-to-reorder

`@byline/ui` ships a generic `DraggableSortable` primitive, so you are not
hand-rolling drag-and-drop.

**Reorder siblings** reuses the existing `reorderCollectionDocument` server fn
(`packages/host-tanstack-start/src/server-fns/collections/reorder.ts`)
**unchanged**. It takes `beforeDocumentId` / `afterDocumentId`, mints a fractional
`order_key` between them, self-heals corrupted/duplicate keys, writes one column
on `byline_documents`, and **mints no document version**. Resolve the two
neighbours from within the dropped node's sibling group and call it — the
function is parent-agnostic.

### Two gestures, two physics — keep them distinct

The single most important UX point: the gestures available in the tree have
different consequences, and they must *look* different so authors aren't
surprised.

| Gesture | Writes | Versioned? | Workflow-gated? |
|---|---|---|---|
| Reorder a **root / sibling** (Model A) | `order_key` on `byline_documents` | No | No — instant |
| **Re-parent** a node (Model A) | the node's `parent` relation | **Yes — new version of the moved node** | Yes |
| Reorder **children** (Model B) | array position in the parent's `children` value | **Yes — new version of the parent** | Yes |

- A **reorder** within a sibling group is a cheap, unversioned metadata flick.
- A **re-parent** (Model A) or a **child reorder** (Model B) is a content change
  that drafts a document and rides its publish workflow.

Make re-parenting an explicit, deliberate interaction (drop *onto* a parent node,
or a "Move to…" affordance) and signal the consequence ("Moving *Indexes* will
save a new version of *Chapter 3*"). The failure mode to avoid is a single flat
collection-wide drag that silently does both — visually it fights the tree
indentation, and behaviourally it conflates an unversioned reorder with a
versioned re-parent.

### Ordering on a global key

Model A's `order_key` is one sequence per collection, but this **does not** block
per-parent sibling ordering. `generateKeyBetween(left, right)`
(`packages/core/src/lib/fractional-index.ts`) needs only the two immediate
neighbours' keys — it does not care who else is in the collection. As long as a
drop resolves its neighbours from **within the same sibling group**, the minted
key sits correctly between those siblings and that group stays internally
monotonic forever. A sibling under a different parent having an interleaving
global key is irrelevant: you always group by parent first, then sort within the
group. The `reorderCollectionDocument` corruption check only looks for
duplicate/equal keys, never tree structure, so reordering is safe as-is.

So: scope the *gesture* to siblings; let the *keyspace* stay global. The global
sequence never leaks into the UI.

---

## Read-side navigation

All three reader-facing pieces are built from native primitives.

### Breadcrumbs — upward walk

Walk from the current node to the root.

- **Model A (parent-up):** populate the `parent` relation repeatedly, or iterate
  `findById` up the chain. Direct and shipped — this is the model's natural
  strength.

  ```ts
  // depth-bounded populate of the parent chain
  await client.collection('docs').findByPath(slug, {
    populate: { parent: { populate: { parent: { populate: { parent: true } } } } },
  })
  ```

- **Model B (children-down):** breadcrumbs need the *inverse* edge ("who lists me
  as a child?"). That is a reverse lookup — supported via the `store_relation`
  reverse index on `(target_collection_id, target_document_id)` and the `$some`
  `where`-quantifier that lands with the `hasMany` phase — but less direct than
  Model A's upward walk.

Each crumb's link target is the node's `path` (see [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md)).

### Previous / Next — flatten the spine

Fetch the collection's nodes with their `parent` + `order_key` (the same read the
tree view uses), build the tree in memory, depth-first flatten to a linear
sequence, and take the entries immediately before and after the current node.
Both models support it; both require the canonical spine — which is exactly why
multi-parenting is excluded (no single linear order otherwise). For a docs-site-sized
corpus this is an in-memory computation over a single read.

### On This Page — client-side, no relations

The typical third level is the set of headings *within* a page. This is a purely
client-side widget that reads the rendered `h2` / `h3` heading nodes (or the
serialized content's heading structure — see [MARKDOWN-EXPORT.md](./MARKDOWN-EXPORT.md))
and builds an anchor list. It involves **no relations and no CMS storage** — it is
not a hierarchy concern at all, and comes "for free" once content renders.

---

## Summary

- Model the hierarchy as a **canonical tree on native field relations**; express
  multi-home topics as **cross-link relation fields**, not multi-parenting.
- **Default to Model A (parent-up)** for anything with real reader navigation or
  more than two levels — it is self-similar at depth, versions only the moved
  node, and matches the upward/spine shape of breadcrumbs and prev/next. It ships
  on shipped primitives today.
- **Reach for Model B (children-down)** only for firmly two-level structures where
  per-parent child ordering and the parent-owns-the-list authoring model are worth
  the dependency on the `hasMany` phase.
- Author through a **custom `listView` tree** — build it in memory, reorder
  siblings via the existing `reorderCollectionDocument` fn, and keep the
  unversioned *reorder* gesture visually and behaviourally distinct from the
  versioned *re-parent* / child-reorder gesture.
- Build **breadcrumbs** (upward parent walk), **prev/next** (in-memory spine
  flatten), and **On This Page** (client-side heading reader) entirely on native
  primitives.
