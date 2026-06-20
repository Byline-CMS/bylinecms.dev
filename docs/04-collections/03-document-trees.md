---
title: "Document Trees"
path: "document-tree"
summary: "A document-grain, single-parent, ordered hierarchy for self-referential collections — the structural backbone for documentation and book sites. Enable it with tree: true and Byline gives you a navigable table of contents, hierarchical URLs, breadcrumbs, and prev/next, all without versioning the structure."
---

# Document Trees

A **document tree** turns a collection into a navigable hierarchy: an ordered,
single-parent table of contents where every document knows its place. It is the
structural backbone for documentation sites, handbooks, and books — anywhere a
set of documents needs a spine, breadcrumbs, and previous/next navigation. This
very documentation site is a document tree.

The tree is **metadata about position**, not content. Where a document sits in
the table of contents says nothing about what the document *is*. So reordering,
nesting, and re-parenting touch no content fields and mint no new versions — they
behave exactly like editing a document's `path`. The structure lives in its own
table, at document grain, outside the version stream. The tree edge is one of the
three document-grain system attributes (alongside `path` and `availableLocales`);
see [Architecture → Document grain vs version grain](../03-architecture/index.md#3-document-grain-vs-version-grain)
for why that grain matters and how it relates to versioning and audit.

## Enabling a tree

Opt in at the **collection definition** (schema) level, not in `defineAdmin` —
the flag changes how the collection is stored and read, not merely how it
renders:

```ts
export const Docs = defineCollection({
  path: 'docs',
  useAsTitle: 'title',
  useAsPath: 'title',
  tree: true,            // ← turns on the document-tree primitive
  fields: [ /* … no `parent` field; the tree owns structure … */ ],
})
```

Turning on `tree: true` enables four things: the tree storage and its commands,
the authoring widget and tree list view in the admin, the hierarchical read path,
and the `afterTreeChange` invalidation event. A tree collection owns its own
ordering, so it cannot also be `orderable: true` — that combination is rejected
at config validation. You do **not** add a `parent` relation field; the tree owns
the parent edge.

## The three states of a node

Every document in a tree collection is in exactly one of three states:

| State | Meaning |
|---|---|
| **Unplaced** | The document exists but has no position in the table of contents. |
| **Root** | A top-level node, ordered among the other roots. |
| **Child** | A nested node, ordered among its siblings under one parent. |

In normal use you rarely see *unplaced*: every new document in a tree collection
is **automatically placed as a root** when it is created, so the tree is never
half-built. Authors then drag nodes into position or set a parent from the
editor. Should a document ever end up unplaced (for example, created through a
path that skipped auto-placement), saving it again re-roots it, and the editor
widget offers an explicit **Add to tree** action.

### The rules that hold

- **Single collection.** A tree relates documents *within one collection*
  (docs → docs). There are no cross-collection trees.
- **Single parent.** Each document has at most one parent. A topic that genuinely
  belongs in two places is expressed with an ordinary cross-link relation field
  ("See also"), never a second tree edge.
- **Deleting a node promotes its children.** Children are never cascade-deleted;
  when their parent is removed they are promoted to root and survive.
- **Per-parent ordering.** Sibling order is scoped to the parent — each parent is
  its own ordering keyspace, so reordering one branch never disturbs another.
- **Locale-agnostic structure.** The tree references the logical document, so all
  locale variants of a document share one position. A localized documentation
  site has **one** structure with localized content hanging off each node.

## Authoring

A tree collection swaps the default list view for a **tree list**: ordered rows
with depth-indented children and an *Unplaced* group for any stragglers. The
placed tree is drag-enabled — a grip handle drags a node together with its whole
subtree, and the drag's horizontal offset projects the target depth and parent
(the Notion-style indent gesture), clamped to what the neighbouring rows allow.
Drops persist immediately and optimistically, reverting with a toast on failure.

The document editor also carries a **tree-placement widget** in its sidebar
(directly alongside the path widget). It uses the collection's own relation
picker to choose a parent, with a "Move to top level" action and, for an unplaced
document, "Add to tree". Editing structure here is immediate and unversioned,
just like editing the path.

## Reading a tree

The tree is not stored in the relation store, so it has its own read path rather
than flowing through relationship population. The primitives are exposed on the
`@byline/client` collection handle and mirror the storage commands:

| Method | Purpose |
|---|---|
| `getSubtree({ rootDocumentId \| null, depth, status })` | Read a nested subtree (node + ordered children). A `null` root reads the whole tree from its roots. |
| `getAncestors({ documentId })` | Walk upward for breadcrumbs — an indexed single-collection lookup. |
| `getTreeParent({ documentId })` | Distinguish *unplaced* (no edge) from *root* (edge, null parent) from *child* (edge, parent set). |
| `placeTreeNode({ documentId, parentDocumentId \| null, before \| after })` | Place, reorder, or re-parent a node — they differ only in whether the parent changes. |
| `removeFromTree({ documentId })` | Remove a node's edge so it becomes unplaced (distinct from deleting the document). |

Subtree reads run a depth-bounded recursive query and return the nodes in
table-of-contents (pre-order) order. The **prev/next spine** is a depth-first
flatten of that ordered tree: a document's neighbours are simply the entries
adjacent to it in the flattened list. Breadcrumbs come from `getAncestors`.

For example, building a navigation tree and a document's breadcrumb +
prev/next neighbours from a frontend loader:

```ts
// The whole published docs tree, in table-of-contents order.
const nav = await client.collection('docs').getSubtree({
  rootDocumentId: null,
  status: 'published',
})

// Breadcrumbs for the current document (root → parent, already ordered).
const ancestors = await client.collection('docs').getAncestors({
  documentId: doc.id,
})

// Prev/next: flatten the ordered tree to a linear spine, find the neighbours.
const spine = []
const flatten = (nodes) => {
  for (const n of nodes) {
    spine.push(n)
    if (n.children?.length) flatten(n.children)
  }
}
flatten(nav)
const i = spine.findIndex((n) => n.id === doc.id)
const prev = spine[i - 1] ?? null
const next = spine[i + 1] ?? null
```

Each node carries its `path` and the full ancestor `chain`, so a link target is
the joined chain (`/docs/getting-started/cli`) rather than the bare slug — the
[public URL resolution](#path-and-url-are-two-independent-axes) section below
covers how those URLs resolve and self-heal.

### Status applies at each edge

A published parent can own a draft-only child. Status is therefore evaluated
**per edge**, not just per document:

- **Public reads** (`status: 'published'`) drop any edge whose child has no
  published version. An unpublished node thus hides its **entire subtree** from
  public navigation — even where individual descendants are published. This is
  the intended semantic: you have not published the chapter, so its topics are
  not yet navigable. Descendants are not re-promoted to fill the gap.
- **Admin/preview reads** (`status: 'any'`) see the full tree.

Because the tree references the logical document, status-at-edge is evaluated
against the locale being read, so a localized site narrows correctly per
language.

## Path and URL are two independent axes

Document trees deliberately separate **where a document is stored** from **how it
is reached**.

**The stored path stays flat.** `byline_document_paths` holds a flat slug
(`cli`), globally unique per `(collection, locale, path)`. Re-parenting,
reordering, and nesting write only the tree table and never touch the path row.
This is what keeps a document untouched by its position: moving a subtree never
rewrites a single stored path. Storing tree-derived paths (`getting-started/cli`)
is intentionally avoided — it would force a re-parent to rewrite the stored path
of an entire subtree, reintroducing exactly the coupling the tree exists to
remove.

**The public URL is composed at read time.** A host app serves a tree collection
through a **splat route** that captures the full path after the base
(`/docs/getting-started/cli`). The loader resolves the *leaf* slug with the
ordinary `findByPath`, derives the ancestor chain with `getAncestors`, and
redirects any non-canonical-but-reachable form to the canonical URL computed from
the live tree:

```ts
const segments = _splat.split('/')                   // ['getting-started', 'cli']
const leaf = segments.at(-1)!                         // 'cli'
const doc = await client.collection('docs')
  .findByPath(leaf, { status: 'published', locale })  // unique per collection + locale
if (!doc) throw notFound()

const ancestors = await client.collection('docs').getAncestors(doc.id)
const canonical = [...ancestors.map((a) => a.path), doc.path].join('/')
if (canonical !== _splat) {
  throw redirect({ to: `/${lng}/docs/${canonical}`, statusCode: 301 })
}

return { doc, ancestors }   // ancestors → breadcrumbs, already ordered
```

This shape has three useful properties:

- **Cheap resolution** — one indexed `findByPath` plus one bounded ancestor walk
  (O(1) + O(depth)). The intermediate segments are used only to validate and
  canonicalize, never to locate the document.
- **Self-healing URLs** — every reachable-but-non-canonical form (wrong
  ancestors, the bare `/docs/cli`, or a stale URL after a re-parent) `301`s to the
  one true URL derived from the live tree. There is no stored redirect table; the
  tree *is* the source of truth.
- **Status-at-edge for free** — running `getAncestors` under `status: 'published'`
  drops at the first unpublished ancestor, so an unreachable chain `404`s,
  enforcing "an unpublished node hides its subtree" at the URL layer.

The markdown / agent surface (the `.md` channel and `llms.txt`) inherits the same
splat treatment, so hierarchical URLs work for `Accept: text/markdown` consumers
too.

Because the leaf slug stays globally unique per collection, the ancestor segments
are structural context rather than part of resolution — you cannot yet have
`getting-started/install` and `advanced/install` coexist as distinct documents.
A non-unique-leaf hierarchy (where the same slug lives under different parents)
would require a composite-key resolver and is a separate concern, not part of the
tree primitive.

## Invalidation

Because tree mutations mint no version, the usual version-write invalidation does
not fire. Each structural write instead emits the **`afterTreeChange`** collection
hook, whose payload is the *affected set* rather than a single node — one
structural change ripples outward to:

- the moved node and **every descendant** (their breadcrumb trails changed),
- the **old** parent's child list and the **new** parent's child list,
- the **prev/next neighbours** on both sides of the flatten (old and new
  positions).

A single drag that relocates a subtree is therefore **one** logical event over
many edges, batched — not one event per edge. Consumers (cache/ISR invalidation,
markdown-export refresh, search reindexing) subscribe to this single event.

## Choosing a hierarchy model

The document tree is the right choice for an arbitrary-depth spine with a single
canonical ordering — documentation, handbooks, books. Two adjacent shapes call
for different tools:

- **Multi-home topics** — a topic that belongs under several parents is a
  cross-link, expressed with an ordinary "See also"
  [relation field](./02-relationships.md), not a second tree edge. The tree keeps
  one canonical spine; cross-links add the lateral connections.
- **Firmly two-level, parent-owns-an-ordered-list structures** — a parent that
  owns an ordered array of children (with order as the array index) is better
  modelled with a `hasMany` relation. The tree and that model address different
  shapes (arbitrary depth versus a fixed two levels) and do not replace one
  another.
