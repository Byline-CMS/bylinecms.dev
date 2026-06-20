---
title: "Document Trees"
path: "document-tree"
summary: "A document-grain, single-parent ordered hierarchy primitive for self-referential collections — the structural backbone for documentation / book sites. Promotes the 'parent' edge out of the versioned content stream and into a dedicated, unversioned tree table alongside path / availableLocales / order_key."
status: "BACKEND + ADMIN + PUBLIC FRONTEND COMPLETE — storage, commands, flag, client API, invalidation, auto-place, the admin tree-placement widget, the built-in tree list view, the public hierarchical-URL splat handler (HTML + .md, canonical 301 / status-at-edge 404), and the tree-rendered docs nav (collapsible drawer with animated caret + auto-expand, tree-ordered index, direct hierarchical links) are shipped and live on the docs collection. Remaining: prev/next spine links and the phase-2 admin drag/drop reorder view (item 3)."
---

# Document Trees

> **Status: backend + admin + public frontend (hierarchical URLs + tree nav)
> complete; prev/next links and phase-2 admin drag reorder remain.** See the
> [Session checkpoint](#session-checkpoint-resume-here) below for exactly what is
> shipped, the decisions reached, and what to build next. The build contract in
> the body of this document still holds.

## Session checkpoint (resume here)

**Shipped and verified (commits on `develop`):**

- **Storage** — `byline_document_relationships` reshaped to a single-parent
  ordered adjacency (`packages/db-postgres/src/database/schema/index.ts`); the
  standalone `packages/db-postgres/sql/0004_document_relationships.sql` for
  existing prod DBs. Run against `byline_dev` + `byline_test`.
- **Storage commands / queries** (`packages/db-postgres/src/modules/storage/`):
  `placeTreeNode`, `removeFromTree`; `getTreeAncestors`, `getTreeChildren`,
  `getTreeSubtree` (recursive CTE, status-at-edge, pre-order DFS). Integration
  tests in `storage-document-tree.test.ts`.
- **`tree: true` flag** on `CollectionDefinition`
  (`packages/core/src/@types/collection-types.ts`); mutual-exclusion with
  `orderable` validated in `config/validate-collections.ts`.
- **`@byline/client` tree API** — `placeTreeNode` / `removeFromTree` /
  `getSubtree` / `getAncestors` on `CollectionHandle`
  (`packages/client/src/collection-handle.ts`).
- **Invalidation** — `afterTreeChange` collection hook fired by the
  `document-lifecycle/tree.ts` service with the affected set; **promote-on-delete**
  wired into `document-lifecycle/delete.ts` (soft-delete promotes children to
  root + removes the node's edge).
- **Auto-place on create** — `document-lifecycle/create.ts` appends every new
  document in a `tree: true` collection as a **root**, so there is no "unplaced"
  limbo in normal use (system step; storage command direct, best-effort, logged).
- **Admin tree-placement widget** — sidebar widget in `FormRenderer`
  (`packages/admin/src/forms/tree-placement-widget.tsx`) using the collection's
  own `RelationPicker` to choose a parent, plus "Move to top level". (The
  "Remove from tree" link was deliberately removed — see decisions.) Host
  transport: `host-tanstack-start/src/server-fns/collections/tree.ts`, wired into
  `byline-field-services.ts`.
- **Built-in tree list view** — `tree: true` collections render
  `host-tanstack-start/src/admin-shell/collections/tree-list.tsx` (ordered rows,
  depth-indented children, an "Unplaced" group). Fed by the `getCollectionTree`
  server fn. Branched in `routes/create-collection-list-route.tsx`.
- **Docs collection is a live tree** — `apps/webapp/byline/collections/docs/schema.ts`
  has `tree: true`; `apps/webapp/byline/scripts/import-docs.ts` builds the tree
  from the `NN-slug/index.md` directory layout (`--tree`). `/docs` reorganized to
  folder-per-doc with `NN-` prefixes; verified 26 roots + nested children.
- **Public hierarchical-URL splat handler (HTML + `.md`)** — `tree: true` docs
  now serve at `/docs/<chain>/<leaf>` via the splat route
  `apps/webapp/src/routes/$lng/_frontend/docs/$.tsx` and its suffixed-splat
  markdown sibling `{$}[.]md.ts`. Shared read-time resolver
  (`apps/webapp/src/modules/docs/resolve.server.ts`): leaf-resolve via
  `findByPath`, derive the chain via `getAncestors`, validate reachability via
  `getTreeParent`, then **301** any non-canonical reachable form to the
  tree-derived canonical and **404** an unreachable one. Status-at-edge is real:
  `getTreeAncestors` gained a `readMode` param so `published` mode stops at the
  first unpublished ancestor (an unpublished node hides its subtree publicly);
  preview reads (`status: 'any'`) see the full tree. `afterTreeChange` now
  invalidates the `docs` collection cache so hierarchical canonical URLs stay
  fresh on re-parent. The old single-segment `docs/$path.tsx` + `{$path}[.]md.ts`
  routes are removed; docs list / menu links target the splat (`_splat`) and
  self-heal to canonical.
- **Tree-rendered docs nav** — the docs drawer is now the document tree, fed by
  `getDocsNavFn` (`apps/webapp/src/modules/docs/nav.server.ts` → `getSubtree`,
  tree order, status-aware), replacing the old flat `orderKey` list read. The
  drawer (`components/menu-drawer.tsx`) renders collapsible branches with an
  animated caret + smooth `grid-template-rows` expand/collapse; the active doc's
  branch auto-expands from the route `_splat` (SSR-correct, JS-free). Drawer +
  index card grid emit direct hierarchical links (no 301 hop); index cards are in
  tree order. Old `list.ts`/`list.server.ts` removed.

**Decisions reached this session (don't re-litigate):**

- Docs filesystem convention: **a folder appears exactly when a node has
  children**; leaves are flat `NN-slug.md`, parents are `NN-slug/index.md`,
  children nest inside. Folder names are free local segments; **paths come from
  frontmatter**, so `NN-` prefixes never reach the slug.
- **The bundle owns order** — `NN-` prefixes are the editorial TOC order;
  `--tree` re-applies them authoritatively each run (no non-destructive mode).
- **Auto-place on create + no "unplaced" UX.** Because `tree: true` is imperative,
  every doc belongs in the tree. New docs auto-place as roots; "Remove from tree"
  was dropped from the widget (to take a doc out of the nav you *delete* it,
  which promotes its children). The `removeFromTree` API still exists for
  programmatic use; the open promote-on-*remove* question is therefore moot for
  the UI.
- The importer tolerates a non-workflow `status:` frontmatter (design docs use
  it descriptively) — see `byline/scripts/lib/frontmatter.ts`.

**What's next (public frontend):**

1. ~~**Public docs splat handler + hierarchical URLs.**~~ **SHIPPED** — see the
   "Public hierarchical-URL splat handler" bullet above and
   [Public URL resolution](#public-url-resolution-the-splat-handler). Breadcrumbs
   render the hierarchical chain (HTML route).
2. ~~**Rendered table of contents / navigation.**~~ **SHIPPED** — the docs nav is
   now the document tree, server-rendered from `getSubtree` in tree order
   (`apps/webapp/src/modules/docs/nav.server.ts` → `getDocsNavFn`, replacing the
   old flat `orderKey` list read). The drawer
   (`apps/webapp/src/modules/docs/components/menu-drawer.tsx`) renders collapsible
   branches with an **animated caret** and a smooth `grid-template-rows` height
   expand/collapse; the active document's branch auto-expands (computed from the
   route `_splat`, SSR-correct and JS-free). Both the drawer and the index card
   grid emit **direct hierarchical links** (each node's full `chain`) — no 301
   hop — and the index cards are in tree (pre-order) order. The compact desktop
   rail stays a flat icon list. The old `list.ts`/`list.server.ts` were removed.
   *Remaining sub-item:* **prev/next** spine links on the detail page (flatten of
   `getSubtree`) — not yet built.
3. **Phase-2 admin list view** — drag-to-reorder + re-parent on the built-in
   tree list view (currently read/browse only; placement is per-doc via the
   widget).

**Heal unplaced docs (shipped).** `getTreeAncestors` returns `[]` for both a
*root* (edge row, parent null) and an *unplaced* doc (no edge row), which
conflated the two. Resolved as planned:

- **`getTreeParent(documentId) → { placed, parentDocumentId }`** primitive — a
  single indexed lookup on the edge table that distinguishes unplaced (no row)
  from root (row, null parent) from child (row, parent set). Declared on
  `IDocumentQueries` (`db-types.ts`), implemented in `storage-queries.ts`,
  surfaced on `CollectionHandle.getTreeParent`, the `getTreeParent` host server
  fn, and the `getTreeParent` field service. Integration coverage in
  `storage-document-tree.test.ts`.
- **Self-heal on update** — `document-lifecycle/internals.ts` factors create's
  auto-place into `appendTreeRoot`; the new `selfHealTreePlacement` checks
  `getTreeParent` and re-roots a genuinely-unplaced doc (guarded, best-effort,
  logged). Wired into both `updateDocument` and `updateDocumentWithPatches`, so
  any save re-trees a stray doc. No-op when already placed.
- **Widget "Add to tree"** — `tree-placement-widget.tsx` now loads placement via
  `getTreeParent` alongside the ancestor chain; an unplaced doc shows "Not in
  tree" + an "Add to tree" action (places as root) instead of the misleading
  "Top level". New i18n keys `treeWidget.notInTree` / `treeWidget.addToTree`
  across all locales. Hosts that don't wire `getTreeParent` degrade to the prior
  behaviour (treat as placed).

Chosen over a standalone "re-tree" command (less ceremony, self-correcting).

**Smaller follow-ups:** filter self/descendants out of the placement picker
(server already rejects them, surfaced as an inline error); decide whether to
drop the now-unused `treeWidget.remove` i18n key.

**To see it running:** restart the webapp dev server (rebuild `@byline/*`; clear
`apps/webapp/node_modules/.vite` if stale). The docs list is at
`/admin/collections/docs`; edit a child (e.g. *Getting Started - Experimental
CLI*) to see the placement widget.

## Thesis

The earliest approach to hierarchy on Byline — call it **Model A (parent-up)** —
built the tree on an ordinary, *versioned* `relation` field (each node carries a
single-target `parent` relation; root nodes have none) plus the global
`order_key`. That works, but it mixes grains: the `parent` relation lives at
**document-version** grain while `order_key` lives at **document** grain. That
asymmetry is the source of every wrinkle that approach has to manage — a global
keyspace shared across all siblings, re-parenting that mints a version, non-atomic
two-grain moves, and a draft-vs-published ordering window.

This spec removes the asymmetry by promoting the hierarchy to a **first-class,
document-grain, unversioned tree primitive** — a fourth structural system field
alongside `path`, `availableLocales`, and `order_key`. The tree is **meta**: it
describes where a document sits in a table of contents and says nothing about the
document's content. Re-parenting, reordering, and nesting touch **no** user
fields and mint **no** versions, exactly like `updateDocumentPath` and
`setOrderKey` today.

The structure is stored in the (reshaped) `byline_document_relationships` table —
the dormant table that was originally built as a many-to-many and was previously
slated for removal. Instead of deleting it, we **constrain** it into a canonical
single-parent ordered tree. The act of constraining is what makes it safe.

## Locked decisions

These are settled; the implementation must hold them.

1. **Self-referential, single collection.** A tree relates documents *within one
   collection* (docs → docs). No cross-collection trees. Matches Model A.
2. **Single parent only.** Each document has at most one parent. No multi-parent
   / leaf reuse. A topic that genuinely belongs in two places is a *cross-link*
   relation field ("See also"), never a second tree edge. This is deliberately
   as opinionated as the single-collection rule.
3. **Never cascade-delete children.** Deleting a node must **promote its children
   to root**, not remove them. The documents survive; they simply lose their
   parent.
4. **Document-grain and unversioned.** Tree mutations write the tree table only.
   They mint no document version, do not reset status, and do not touch user
   fields. They are pure structural metadata, like `path` / `availableLocales` /
   `order_key`.
5. **Per-parent ordering.** Sibling order is an `order_key` *on the edge row*,
   scoped to the parent. Each parent is its own ordering keyspace.
6. **Collection-flag gated.** A collection opts in via a definition-level flag.
   The flag turns on the tree storage, the authoring widget, and the read path.
   Collections without it are unaffected.

## Why per-parent ordering matters (what it fixes)

Moving `order_key` into the edge row, partitioned by parent, dissolves the three
problems the parent-up relation-field approach (Model A) has to live with:

- **Cross-sibling key collisions → gone.** Under the global `order_key`, two
  independent sibling-scoped reorders share one keyspace and can occasionally
  mint colliding keys, tripping `reorderCollectionDocument`'s collection-wide
  corruption detector and forcing an O(n) re-key. With ordering scoped to
  `(parent_document_id)`, siblings under different parents are never compared, so
  the collision path cannot occur.
- **Grain skew → gone.** Parent and order now live in the *same row* at the same
  grain. A re-parent-at-position is a single transactional edge upsert (set
  parent + mint key among the new siblings). Atomic.
- **Draft-vs-published ordering window → gone.** Because the tree is unversioned,
  there is no draft-parent / published-parent divergence and no single
  `order_key` straddling two sibling groups.

## Table shape (reshape of `byline_document_relationships`)

Current shape (`packages/db-postgres/src/database/schema/index.ts`) is a
many-to-many edge list: `(parent_document_id, child_document_id, createdAt)` with
`unique(parent_document_id, child_document_id)`, both FKs `onDelete: cascade`, no
ordering. Reshape to a single-parent ordered adjacency model:

| Column | Change | Why |
|---|---|---|
| `child_document_id` | FK → `documents.id`, **`onDelete: cascade`** | When the node itself is deleted, its membership row disappears — it leaves the tree. |
| `parent_document_id` | FK → `documents.id`, **nullable**, **`onDelete: 'set null'`** | Nullable = root. `set null` = automatic "promote children to root" when a parent document is deleted (decision 3), at the DB level. |
| `order_key` | **new**, byte-sorted varchar (same collation as `byline_documents.order_key`) | Per-parent sibling order (decision 5). |
| `created_at` / `updated_at` | keep `created_at`; **add `updated_at`** | Structure is now editable, not append-only. |
| *(audit)* | optional `created_by` / `updated_by` | Ties into the document-grain audit-log work; structural moves are auditable events. |

Constraints / indexes:

- **`unique(child_document_id)`** — replaces the pair-unique. This is the
  single-parent invariant (decision 2). Each document appears in at most one row.
- **`index(parent_document_id, order_key)`** — the per-parent sibling read, in
  order. Drives both the authoring tree and the read-side flatten.

> The previous comment claimed "FK constraints are not used; integrity at the
> application layer," yet the code declared cascading FKs. The reshape makes the
> FKs load-bearing and *correct*: cascade on child (leave the tree), set-null on
> parent (promote to root).

## Node placement — the tri-state

`unique(child_document_id)` + nullable parent yields three clean states per
document:

| State | Edge row | Meaning |
|---|---|---|
| **Unplaced** | no row | Created but not yet inserted into the TOC. Not in the tree. |
| **Root** | row, `parent_document_id IS NULL` | Top-level node; ordered among roots by `order_key`. |
| **Child** | row, `parent_document_id` set | Nested node; ordered among its parent's children by `order_key`. |

All ordering — roots included — lives in the edge table. For a tree collection,
`byline_documents.order_key` is unused; the edge `order_key` is authoritative.

## Write path

All tree writes are new document-grain commands (siblings of
`updateDocumentPath` / `setOrderKey`), unversioned, each firing the invalidation
hook (below).

- **Place / move to a position** — upsert the node's edge row: set
  `parent_document_id` (or NULL for root) and mint `order_key` with
  `generateKeyBetween(leftSibling, rightSibling)` resolved **within the target
  sibling group**. Single row, single transaction.
- **Reorder within siblings** — same upsert, parent unchanged, new `order_key`
  between the in-group neighbours. (This *replaces* `reorderCollectionDocument`
  for tree collections — that fn operates on `byline_documents.order_key`, which
  a tree collection no longer uses.)
- **Re-parent** — set `parent_document_id` + mint a key among the new siblings,
  in one transaction. Atomic; no version; no status change.

Two invariants the write path must enforce in application code (the DB cannot):

- **Cycle guard.** A parent pointer can form cycles (A→B while B→A). Before any
  re-parent, walk the ancestor chain of the target parent and reject if the moved
  node appears. Concurrency makes this real — two editors cross-moving — so the
  check and the write belong in one transaction.
- **Same-collection guard.** Both endpoints must belong to the flag-bearing
  collection (decision 1).

**Promote-on-delete.** `onDelete: 'set null'` handles the *data* (children's
`parent_document_id` → NULL, i.e. promoted to root). But two things still want an
application-level delete command: (a) firing the invalidation fan-out for the
promoted subtree, and (b) optionally re-keying the promoted orphans into the root
group (they otherwise inherit a stale per-parent key, which sorts them arbitrarily
among roots — harmless but untidy).

## Read path

The tree is **not** in `store_relation`, so the existing `populateDocuments` /
relation-envelope / `beforeRead` pipeline does not see it. The tree gets its own
read path:

- **Subtree read** — a recursive CTE over `byline_document_relationships`,
  depth-bounded, joined to the document content. Returns a nested shape (node +
  ordered children) for the authoring tree and for server-rendered navigation.
  Carry a **depth column** in the CTE and a caller-supplied max depth as a
  backstop; the cycle guard prevents true cycles, but a bounded recursion is
  cheap insurance and gives the read its `depth` semantics.
- **Status at the edge level.** A published parent can own a draft-only child.
  Public reads join `byline_current_published_documents` and **drop edges whose
  child has no published version** — otherwise breadcrumbs / prev-next point at
  404s. Admin reads join `byline_current_documents` (status `any`). The
  published/any axis applies per *edge*, not just per document.
- **Unpublished nodes hide their subtree (decision).** In a strict single-parent
  tree, a node whose parent edge is dropped (parent unpublished) is unreachable
  via the spine — so an unpublished mid-tree node makes its **whole subtree absent
  from public navigation**, even where individual descendants are published. This
  is the intended semantic: you have not published the chapter, so its topics are
  not yet navigable. Descendants are *not* promoted to the dropped node's parent
  for public reads. (Authors still see the full tree under status `any`.)
- **Flatten for prev/next** — depth-first walk of the ordered tree gives the
  linear spine; previous/next are the entries adjacent to the current node.
- **Breadcrumbs** — walk `parent_document_id` upward (now a direct, indexed
  single-collection lookup, not a populate of a versioned relation).

Breadcrumb and prev/next **link targets remain `path`** (see below); the tree
provides structure and order, `path` provides the URL.

### Locale semantics

The tree references the **logical `document_id`**, so a node's position is
**per-document and locale-agnostic** — all locale variants of a document share one
tree position. A localized documentation site has **one structure**, with
localized content hanging off each node. Status-at-edge (above) is evaluated
against the locale being read. This is the correct grain: the table of contents is
a property of the work, not of a translation.

### Public URL resolution (the splat handler)

Hierarchical public URLs (Axis 2 in [Path & URL](#path--url-two-independent-axes))
are served by a host-app **splat** route, not by storing hierarchical paths. This
leans entirely on primitives the tree already provides and changes no storage.

The current docs route is a single-segment `$lng/_frontend/docs/$path.tsx`
resolved via `client.collection('docs').findByPath(path)`, with a parallel
markdown channel `docs/{$path}.md.ts`. A single `$path` captures exactly one
segment; a tree collection swaps it for a splat — the bare `$.tsx` file — which
exposes `params._splat` = everything after `/docs/`. (This is a **public
frontend** route change only — the host-package *admin* route resolution is
unrelated and unchanged.)

Loader (server-side, SSR), **leaf-resolve + canonicalize**:

```ts
const segments = _splat.split('/')                  // ['getting-started','cli']
const leaf = segments.at(-1)!                        // 'cli'
const doc = await client.collection('docs')
  .findByPath(leaf, { status: 'published', locale }) // unique per collection+locale
if (!doc) throw notFound()

const ancestors = await client.collection('docs').getAncestors(doc.id)
const canonical = [...ancestors.map((a) => a.path), doc.path].join('/')
if (canonical !== _splat) {
  throw redirect({ to: `/${lng}/docs/${canonical}`, statusCode: 301 })
}

return { doc, ancestors }   // ancestors → breadcrumbs, already ordered
```

Properties that make this the right shape:

- **Cost is O(1) + O(depth).** One indexed `findByPath` plus one bounded ancestor
  walk. The *intermediate* segments are never used to locate the document — only
  to validate and canonicalize — so resolution reuses existing infrastructure.
- **Self-healing canonical URL.** Every non-canonical-but-reachable form (wrong
  ancestors, the bare `/docs/cli`, a stale URL after a re-parent) `301`s to the
  one true URL computed from the live tree. No stored redirect table for
  re-parents — the tree *is* the source of truth and the redirect is derived.
- **Status-at-edge falls out for free.** Run `getAncestors` under
  `status: 'published'` and it drops at the first unpublished ancestor → the chain
  cannot validate → 404, enforcing the "unpublished node hides its subtree"
  decision at the URL layer. (`getAncestors` must apply the published-*edge*
  filter, not merely resolve IDs.)
- **Markdown/agent surface inherits it.** The `.md` channel gets the same splat
  treatment, so hierarchical URLs work for `Accept: text/markdown` and `llms.txt`.

Two tree-specific decisions for the handler:

- **Unplaced docs** (in the collection, no tree edge) have a `path` but empty
  ancestors. Default: serve `/docs/<slug>` with canonical = bare slug rather than
  404 — they are still published resources.
- **Ownership.** The route is app-owned at a known prefix, so it already knows the
  collection. If the host package ships it, it is a route *factory*
  (`createTreeContentRoute({ collection, basePath })`) but the file stays
  app-owned — and, unlike the admin splat, it must **not** pass through the admin
  auth boundary; it is a public read.

The **composite-key alternative** (only if leaf-uniqueness is later relaxed) keeps
the same splat route but swaps the resolver body: walk *down* — resolve the root by
the first segment, then `getChildBySlug(parentId, segment)` per hop — O(depth)
queries instead of 1 + walk, plus a `(parent, slug)` resolution primitive.

## Invalidation contract

Tree mutations mint no version, so the normal version-write invalidation does not
fire. Each tree write must emit a **collection lifecycle event** whose payload is
the **affected set**, not a single node — because one structural change ripples:

- the moved node,
- **every descendant** (their breadcrumb trails changed),
- the **old** parent's child list,
- the **new** parent's child list,
- the **prev/next neighbours on both sides** of the flatten (old position and new
  position).

A single drag that relocates a subtree is **one** logical event over many edges,
batched — not N events. Consumers (cache/ISR invalidation, markdown-export
refresh, search reindex) subscribe to this event. Note that
`reorderCollectionDocument` today fires *no* hook at all; this is new surface.

## Command surface (proposed)

New document-grain commands on the storage adapter, mirroring the
`updateDocumentPath` / `setOrderKey` pattern (unversioned, single-row writes).
Names are provisional:

| Command | Effect |
|---|---|
| `placeTreeNode({ document_id, parent_document_id \| null, before \| after })` | Insert/move a node: set parent (or root) and mint `order_key` between the resolved in-group neighbours. Covers place, reorder, and re-parent — they differ only in whether `parent_document_id` changes. |
| `removeFromTree({ document_id })` | Delete the node's edge row (node becomes *unplaced*). Distinct from document deletion. |
| `getSubtree({ root_document_id \| null, depth, status })` | Recursive-CTE read (above). `null` root = whole tree from the roots. |
| `getAncestors({ document_id })` | Breadcrumb walk upward. |

The cycle guard and same-collection guard live inside `placeTreeNode`, in the same
transaction as the write. Each mutating command emits the invalidation event.

These are surfaced through `@byline/client` as a small tree API on the
collection handle (shape TBD) so frontend developers get the same ergonomics as
the rest of the client — and so the authoring widget and public navigation read
through one path.

## Migration & adoption

- **Schema migration.** The reshape is a Drizzle migration: drop the pair-unique,
  add `unique(child_document_id)`, make `parent_document_id` nullable, change the
  parent FK to `onDelete: 'set null'` (keep child FK `onDelete: cascade`), add
  `order_key` + `updated_at` (+ optional audit columns), add
  `index(parent_document_id, order_key)`. The table is **dormant and empty** (no
  code reads or writes it today), so there is no data backfill — the migration is
  pure DDL.
- **Drizzle `relations()` wiring.** The existing `documentRelationshipsRelations`
  (`schema/index.ts`, ~L701) and the `parent_relationships` / `child_relationships`
  entries on `documentsRelations` (~L688) must be updated — they currently point
  `parent`/`child` at `documentVersions` while the FK targets `documents`. Fix to
  reference `documents` and the single-parent shape. The `common.ts` comment about
  "append-only relationship rows" also no longer applies (the table is now
  editable, with `updated_at`).
- **Collection adoption.** Flipping `tree: true` on an existing collection leaves
  every document **unplaced** (no edge rows) — the tree starts empty and authors
  build it via the widget. No automatic placement. A collection can be migrated
  off the legacy Model A `parent` relation field by reading that field once and
  seeding `placeTreeNode` calls, but that is a per-site script, not a platform
  migration.

## Collection flag

Opt-in at the **collection definition** (schema) level — not `defineAdmin` —
because the flag changes storage authority and the read path, not just
presentation:

```ts
export const Docs = defineCollection({
  path: 'docs',
  useAsTitle: 'title',
  useAsPath: 'title',
  tree: true,            // ← turns on the document-tree primitive
  fields: [ /* … no `parent` relation field; the tree owns structure … */ ],
})
```

The flag turns on: the edge-table storage + commands, the authoring tree widget
(replacing the default list view), the recursive read path, and the invalidation
event. A `tree: true` collection does **not** also set `orderable: true` — the
tree owns ordering; `byline_documents.order_key` is inert for it.

> Naming is open. `tree: true` describes the mechanism; `documentation: true`
> (floated in discussion) describes the use case. Prefer naming the mechanism,
> since a single-parent ordered tree is useful beyond documentation sites.

## Path & URL: two independent axes

This design separates **where a document is stored** from **how it is reached**.
An earlier framing conflated them under one "keep paths flat" banner, which
overstated the cost of hierarchical URLs. They are two axes:

**Axis 1 — stored canonical path (LOCKED: flat, tree-independent).**
`byline_document_paths` continues to store a flat slug (`cli`), globally unique
per `(collection_id, locale, path)`. Re-parenting, reordering, and nesting write
**only** the tree table and **never** touch the path row. This preserves the core
purity of the design — a document is untouched by its position in the tree — and
it is non-negotiable. Tree-*derived* stored paths (writing `getting-started/cli`
into the path column) are explicitly rejected: they would force a re-parent to
rewrite the stored path of the **entire subtree**, the exact grain-mixing this
primitive exists to remove.

**Axis 2 — public URL presentation (a separate, deferred-but-cheap choice).**
The URL a visitor uses is *composed at read time*, independent of how the path is
stored. Two options, neither of which touches Axis 1:

- **Flat URL** (`/docs/cli`) — the single-segment route in use today
  (`$lng/_frontend/docs/$path.tsx`). No tree involvement.
- **Hierarchical URL via read-time composition** (`/docs/getting-started/cli`) — a
  public **splat** route resolves the leaf slug with the existing `findByPath`,
  derives the ancestor chain with the tree's own `getAncestors`, and `301`s any
  non-canonical reachable form to the URL computed from the live tree. **No stored
  path is rewritten on re-parent**; the redirect is *derived*, not persisted. See
  [Public URL resolution](#public-url-resolution-the-splat-handler) under the read
  path for the worked handler.

Hierarchical URLs are **web-correct and worth having** for tree collections: they
give a single canonical URL per document while signalling the resource's location
in the hierarchy, and they make re-parents self-healing (old URL → derived 301)
without a redirect table. They are *decorative* in one precise sense — because the
leaf slug stays globally unique per collection (Axis 1), you cannot yet have two
documents share a leaf under different parents (`getting-started/install` **and**
`advanced/install`). The ancestor segments are structural context, not part of
resolution. Breadcrumbs still render *from the tree* (structure) while *linking to
the composed URL* — the two systems cooperate without coupling.

**True non-unique-leaf hierarchy** (where `a/install` and `b/install` coexist) is
the one variant that *does* reach into storage: it requires relaxing the unique
index to `(collection_id, locale, parent, slug)` and a composite-key resolver that
walks down the chain instead of leaf-looking-up. That is a deliberate,
separately-owned future feature — **out of scope here** — but it is named so the
read-time-composition option above is not mistaken for the ceiling.

**Net:** Axis 1 is locked flat. Axis 2 is a presentation choice the host app makes
per tree collection; the read-time-composition route is the recommended default
for documentation sites and costs only a splat route + the spec's existing
`getAncestors`.

## Relationship to the prior relation-field approach

This primitive **supersedes the Model A (parent-up) mechanics** described above —
the single-target `parent` *relation field* plus global `order_key`. The earlier
parent-up model is no longer the recommended way to build a hierarchy; this
document is the present design.

- Model A's "single-target `parent` *relation field*" becomes "the `tree: true`
  document-grain primitive." The reader-facing conclusions of a documentation site
  (canonical single spine, **cross-links** for multi-home topics — an ordinary
  "See also" relation field, never a second tree edge — breadcrumbs + prev/next +
  client-side On-This-Page) are unchanged. Only the *storage and grain* of the
  parent edge change.
- **Model B (children-down)** — a `hasMany` `children` array owned by the parent,
  with child order as the array index — is a separate, unaffected option. It
  remains the alternative for firmly two-level structures that want the
  parent-owns-an-ordered-list authoring model, and it depends on the planned
  `hasMany` phase (see [RELATIONSHIPS.md](./RELATIONSHIPS.md)). The `tree: true`
  primitive does not replace it; the two address different shapes (arbitrary depth
  vs. firmly two-level).

## Open items (not yet decided)

- **Audit columns** — whether `created_by` / `updated_by` land in v1 or follow
  the broader audit-log work. (Not in the shipped `0004` reshape.)
- **Authoring widget scope** — full drag-the-whole-TOC tree vs. incremental
  per-node "move to…"; both ride the same write commands. (Widget not yet built.)
- **Unplaced-doc public routing** — default is to serve `/docs/<slug>` for a
  document with no tree edge (canonical = bare slug); confirm vs. 404-until-placed.
- **Hierarchical-URL adoption** — whether the read-time-composition splat ships
  with the primitive or follows as a per-site frontend opt-in.

Resolved: flag name is **`tree: true`**; self-referential single collection;
single-parent only; promote-orphans-to-root (no cascade); per-parent ordering;
**stored path stays flat / tree-independent (Axis 1)** while hierarchical public
URLs are an optional read-time-composition presentation choice (Axis 2);
unpublished nodes hide their subtree publicly; tree is per-logical-document
(locale-agnostic); **promote-on-delete re-keys orphans eagerly** (the delete
lifecycle calls `placeTreeNode(child, { parentDocumentId: null })`, minting a
fresh root-group key); **the invalidation event is the `afterTreeChange`
collection hook**, fired once per structural write (place / remove /
promote-on-delete) with the affected set, by the `document-lifecycle` tree
service; **the client tree-API surface** is `placeTreeNode` / `removeFromTree` /
`getSubtree` / `getAncestors` on the collection handle.
</content>
</invoke>
