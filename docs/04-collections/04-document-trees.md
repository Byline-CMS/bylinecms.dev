---
title: "Document Trees"
path: "document-tree"
summary: "A document-level, single-parent, ordered hierarchy for self-referential collections — the structural backbone for documentation and book sites. Enable it with tree: true and Byline gives you a navigable table of contents, hierarchical URLs, breadcrumbs, and prev/next, all without versioning the structure."
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
table, at document level, outside the version stream. The tree edge is one of the
three document-level system attributes (alongside `path` and `availableLocales`);
see [Architecture → Document level vs version level](../03-architecture/index.md#3-document-level-vs-version-level)
for why that distinction matters and how it relates to versioning and audit.

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
and the `afterTreeChange` invalidation event. A tree collection also requires an
adapter that can lock, mutate, reconcile deletion, and append audit rows
atomically. These are mandatory parts of the canonical 4.x `IDbAdapter`, not
optional capabilities; the startup audit/delete-reconciliation check remains as
a runtime guard for untyped JavaScript adapters. A tree collection
owns its own ordering, so it cannot also be `orderable: true` — that combination
is rejected at config validation. You do **not** add a `parent` relation field;
the tree owns the parent edge.

## The three states of a node

Every document in a tree collection is in exactly one of three states:

| State | Meaning |
|---|---|
| **Unplaced** | The document exists but has no position in the table of contents. |
| **Root** | A top-level node, ordered among the other roots. |
| **Child** | A nested node, ordered among its siblings under one parent. |

In normal use you rarely see *unplaced*: after creating a document, the
lifecycle makes a best-effort attempt to append it as a root. The placement and
its tree audit row are atomic with each other, but are deliberately separate
from the version create; a runtime placement failure is logged and create still
returns, leaving the document unplaced. Saving an unplaced document makes the
same best-effort, race-safe repair without moving an already-placed node, and
the editor widget offers an explicit **Add to tree** action. Automatic create /
update repair is covered by `afterCreate` / `afterUpdate`, not a second
`afterTreeChange` event.

### The rules that hold

- **Single collection.** A tree relates documents *within one collection*
  (docs → docs). There are no cross-collection trees.
- **Single parent.** Each document has at most one parent. A topic that genuinely
  belongs in two places is expressed with an ordinary cross-link relation field
  ("See also"), never a second tree edge.
- **Deleting a node promotes its children.** Children are never cascade-deleted;
  its direct children become roots, preserve their sibling order, and append
  after existing roots. Soft deletion, promotion, edge removal, and all related
  audit rows commit or roll back together.
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
Admin mutation requests enable no-op reconciliation by default, so retrying an
already-committed drop can re-run a failed post-commit invalidation hook. Direct
SDK callers opt into that behavior with `reconcile: true`.

The tree list runs moves as a **single-flight** across pointer and keyboard
input. While one mutation plus its canonical router refresh is in flight, drag
handles are disabled and a second move is suppressed. The admin refreshes loader
data after both success and failure; a rejected mutation restores the prior
optimistic state, stale-tree conflicts get their own toast, and refresh failure
is reported separately. A successful mutation followed by refresh failure is
not misreported as a mutation failure: the optimistic state remains and the
admin shows a refresh warning.

The document editor also carries a **tree-placement widget** in its sidebar
(directly alongside the path widget). It uses the collection's own relation
picker to choose a parent, with a "Move to top level" action and, for an unplaced
document, "Add to tree". Editing structure here is immediate and unversioned,
just like editing the path.

## Reading a tree

The tree is not stored in the relation store, so it has its own read path rather
than flowing through relationship population. The public primitives are exposed
on the `@byline/client` collection handle:

| Method | Purpose |
|---|---|
| `getSubtree({ rootDocumentId, depth, status, … })` | Read a nested subtree (node + ordered children). A `null` root reads the whole tree from its roots. |
| `getAncestors(documentId, { status, locale, … })` | Walk upward for breadcrumbs — an indexed single-collection lookup. |
| `getTreeParent(documentId, { status, locale, … })` | Distinguish *unplaced* from *root* from *child*, without leaking a hidden parent id. |
| `placeTreeNode(documentId, { parentDocumentId, beforeDocumentId, afterDocumentId, reconcile })` | Place, reorder, or re-parent a node — they differ only in whether the parent changes. |
| `removeFromTree(documentId, { reconcile })` | Remove a node's edge so it becomes unplaced (distinct from deleting the document). |

### Authoritative mutation contracts

The adapter and lifecycle/SDK layers intentionally return different shapes. The
canonical adapter signatures are:

```ts
placeTreeNode({
  collectionId,
  documentId,
  parentDocumentId,
  beforeDocumentId?,
  afterDocumentId?,
  ifUnplaced?,
}): Promise<TreeMutationResult>

removeFromTree({
  collectionId,
  documentId,
  includeSubtree?,
}): Promise<TreeMutationResult>

promoteChildrenAndRemoveFromTree({
  collectionId,
  documentId,
}): Promise<TreeDeleteMutationResult>
```

`TreeMutationResult` is `{ changed, before, after,
beforeSiblingDocumentIds, beforeSubtreeDocumentIds }`; each placement snapshot
is `{ placed, parentDocumentId, orderKey, index }`. Delete reconciliation returns
`{ removed: TreeMutationResult, promoted: Array<{ documentId, before, after }> }`.
These locked snapshots drive audit rows and post-commit invalidation fan-out.

The lifecycle and collection handle deliberately narrow those internals:
`CollectionHandle.placeTreeNode(documentId, options)` resolves to
`{ orderKey: string }`, while `CollectionHandle.removeFromTree(documentId,
options)` resolves to `void`. `ifUnplaced` and `includeSubtree` are internal
adapter controls, not SDK options.

Neighbour ids are assertions about one exact target gap, not loose ordering
hints. `beforeDocumentId` is the left neighbour and must still be last when no
right neighbour is supplied; `afterDocumentId` is the right neighbour and must
still be first when no left neighbour is supplied; when both are supplied they
must still be adjacent. A neighbour that moved to another parent, a changed edge
boundary, or a concurrent writer that already occupied the asserted gap yields
`ERR_CONFLICT`. The moving document and target parent must also still have a
current, non-deleted version; a stale or soft-deleted endpoint yields the same
`ERR_CONFLICT`. Structural misuse such as identical neighbour ids, self-parenting,
cross-collection endpoints, or a cycle remains validation/not-found behavior,
not a stale-write conflict.

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
const ancestors = await client.collection('docs').getAncestors(doc.id, {
  status: 'published',
  locale,
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
const i = spine.findIndex((n) => n.document.id === doc.id)
const prev = spine[i - 1] ?? null
const next = spine[i + 1] ?? null
```

Each `TreeNode` carries `{ document, depth, children }`; its leaf path is
`node.document.path`. Build a full link while recursively walking parent
segments, or call `getAncestors()` for one document. The resulting joined chain
(`/docs/getting-started/cli`) rather than the bare slug is covered in
[public URL resolution](#path-and-url-are-two-independent-axes) below.

### Status applies at each edge

A published parent can own a draft-only child. Status is therefore evaluated
**per edge**, not just per document:

- **Public reads** (`status: 'published'`) drop any edge whose child has no
  published version. An unpublished node thus hides its **entire subtree** from
  public navigation — even where individual descendants are published. This is
  the intended semantic: you have not published the chapter, so its topics are
  not yet navigable. Descendants are not re-promoted to fill the gap.
- **Admin/preview reads** (`status: 'any'`) see the full tree.

Structural visibility checks the selected current or published view, not locale
completeness. The requested locale controls path/field reconstruction and any
localized `beforeRead` predicate, with normal content fallback; a node is not
removed from the structure merely because that locale lacks a translation.

`beforeRead` uses the same strict edge semantics. The security predicate is
validated in strict mode before use; unsupported predicates throw rather than
being silently weakened. `getSubtree` omits a hidden node and its descendants
without promotion. `getAncestors` stops at the first hidden ancestor (and
returns no chain when the queried node itself is hidden). `getTreeParent`
reports a hidden queried node as unplaced; for a visible child whose parent is
hidden it preserves `placed: true`, redacts `parentDocumentId` to `null`, and
returns `parentVisibility: 'redacted'`. Hydration re-applies the same filters to
close structure/read races, never compacting past a newly hidden edge.

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

const ancestors = await client.collection('docs').getAncestors(doc.id, {
  status: 'published',
  locale,
})

// A truncated ancestor walk means a hidden node sits above the visible chain.
const topId = ancestors.at(0)?.id ?? doc.id
const parent = await client.collection('docs').getTreeParent(topId, {
  status: 'published',
  locale,
})
if (parent.parentVisibility === 'redacted' ||
    (parent.placed && parent.parentDocumentId != null)) {
  throw notFound()
}

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
- **Status-at-edge with an explicit reachability check** — `getAncestors` drops
  at the first unpublished or row-hidden ancestor. Checking the top resolved
  node's parent state distinguishes a true root from a truncated chain, so the
  latter `404`s instead of redirecting to a shorter URL.

The markdown / agent surface (the `.md` channel and `llms.txt`) inherits the same
splat treatment, so hierarchical URLs work for `Accept: text/markdown` consumers
too.

Because the leaf slug stays globally unique per collection, the ancestor segments
are structural context rather than part of resolution — you cannot yet have
`getting-started/install` and `advanced/install` coexist as distinct documents.
A non-unique-leaf hierarchy (where the same slug lives under different parents)
would require a composite-key resolver and is a separate concern, not part of the
tree primitive.

## Audit and atomicity

An actual explicit mutation records exactly one action with locked before/after
placement snapshots (`placed`, `parentDocumentId`, `orderKey`, sibling `index`):
`document.tree.placed`, `.reparented`, `.reordered`, or `.removed`. Concurrent
mutations in one collection are serialized, so the predecessor snapshot and
no-op decision are authoritative. Deleting a tree node records one reparent
action per promoted child and a removal action when an existing edge is removed
or children are promoted; those rows share the soft-delete transaction. An
already-unplaced leaf records only `document.deleted`.

Direct storage soft deletion uses the same lock order as tree mutation:
collection row first, then document/version state. This makes a direct
`softDeleteDocument` serialize with endpoint liveness validation and avoids the
document-first/collection-second inversion that would deadlock lifecycle
deletion. Application writes should still use the lifecycle service so deletion
also reconciles edges and writes audit rows.

Automatic root placement on create/update is the exception described above: its
placement + audit are atomic, but the preceding version write is already
committed and a runtime placement failure is best-effort.

For deletion, the database boundary includes the soft delete, direct-child
promotion, edge removal, and every delete/tree audit row. Once that transaction
commits, the delete is committed even if storage cleanup or post-commit tree and
delete hooks fail. The lifecycle returns
`outcome: 'committed-with-side-effect-failures'` instead of rejecting for those
failures; the host exposes only sanitized phase/code data, and the admin still
navigates to the collection list with a warning toast.

## Invalidation

Because tree mutations mint no version, the usual version-write invalidation does
not fire. An actual explicit place/reorder/re-parent/remove, or a delete that
removes an edge or promotes children, emits **one post-commit `afterTreeChange`** event. Its `affectedDocumentIds` is a
conservative invalidation set: the moved/removed subtree, old and new parents,
and the complete affected old/new sibling groups. Delete promotion includes the
deleted node and promoted child subtrees. Consumers should treat the set as a
safe superset, not a minimal diff.

An exact placement or already-unplaced removal is a true no-op: no structural
write, audit row, or hook. With `reconcile: true`, that same no-op emits a
broader event so a caller can retry side effects after an earlier post-commit
hook failure; it still writes and audits nothing. The tree event has no separate
reconciliation flag, so consumers must be idempotent. Admin tree mutations
default this option to true; SDK callers opt in explicitly.

For explicit place/remove operations, a hook failure rejects the call after tree
and audit data have committed, enabling the no-op reconciliation retry above.
The rejection is a coded `BylineError` with
`code: 'ERR_TREE_HOOK_COMMITTED'`; the SDK rejection contract is unchanged, but
hosts can distinguish committed structure from a rolled-back mutation. The
TanStack host preserves core `BylineError` codes across server-function
serialization. Its admin tree keeps the optimistic move, shows a warning rather
than a structural-failure toast, and refreshes canonical rows. If that refresh
also fails, it retains the optimistic rows until a later loader result or manual
reload; ordinary mutation failures still roll back immediately. A
tree document delete is different: `afterTreeChange` and `afterDelete` are each
attempted so one failure cannot suppress the other, but failures resolve as the
committed-with-side-effect-failures outcome rather than rejecting. There is no
durable retry/outbox yet.
Cache/ISR and markdown consumers can subscribe here. Search reindexing is needed
only if a provider stores tree-derived hierarchy — the reference docs app stores
the flat leaf path and invalidates its tree-derived cache without reindexing.

## Recovering the docs tree from markdown

The repository importer can restore content and then reapply the folder/index
hierarchy in one run:

```sh
pnpm tsx apps/webapp/byline/scripts/import-docs.ts 'docs/**/*.md' --force --tree
```

`--force` recovers a soft-deleted document that still owns an imported path
without exposing its previous published versions. It temporarily stages only
the latest tombstoned version under a non-published status, runs the normal
update and requested status transitions, then re-tombstones that staging row.
The document id, path row, historical version rows and statuses, and audit rows
are preserved.
If the update or any ordinary post-commit hook/status step reports failure, a
compensating write re-tombstones every version, including a replacement version
that committed before an after-hook failed, then the configured `afterDelete`
hooks reconcile search and cache state. Compensation or reconciliation failures
are aggregated with the original error and remain fatal.

Recovery takes a path-scoped Postgres advisory lock, which serializes competing
`--force` import processes for the same path. Ordinary lifecycle writers do not
take that maintenance lock. Run forced recovery without concurrent editorial
writes to the recovered documents; without a durable operation id on version
rows, compensation cannot distinguish its replacement from a version committed
concurrently by an editor.

`--tree` then places successful imports in deterministic source-file order using
the folder plus `index.md` / `index.markdown` convention.
Tree placement failures are collected and summarized, then propagated as an
`AggregateError`; the CLI exits nonzero rather than reporting a successful
recovery with a partial tree.

The command has an explicit **imported-batch/no-prune boundary**; it is not a
database-wide mirror. Only documents successfully imported in that invocation
participate. A source parent outside the batch is not resolved from the database,
so its imported child is treated as a root, and existing documents/edges absent
from the batch are never removed, unplaced, or pruned. Include the complete
intended markdown tree when using this command as a structural recovery
operation.

## Choosing a hierarchy model

The document tree is the right choice for an arbitrary-depth spine with a single
canonical ordering — documentation, handbooks, books. Two adjacent shapes call
for different tools:

- **Multi-home topics** — a topic that belongs under several parents is a
  cross-link, expressed with an ordinary "See also"
  [relation field](./03-relationships.md), not a second tree edge. The tree keeps
  one canonical spine; cross-links add the lateral connections.
- **Firmly two-level, parent-owns-an-ordered-list structures** — a parent that
  owns an ordered array of children (with order as the array index) is better
  modelled with a `hasMany` relation. The tree and that model address different
  shapes (arbitrary depth versus a fixed two levels) and do not replace one
  another.
