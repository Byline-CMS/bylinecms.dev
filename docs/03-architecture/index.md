---
title: "Key Architectural Decisions"
path: "architecture"
summary: "The load-bearing design decisions behind Byline: universal EAV storage, immutable versioning, the document-level vs version-level split (path, available locales, tree edge), patch-based updates, the schema/admin split, and the authorization model. Each links to its full reference."
---

# Key Architectural Decisions

These are the load-bearing decisions behind Byline. Each is described in depth in
its own reference document; this page is the map.

## 1. Universal storage (EAV-per-type)

Byline stores every document in a general-purpose model that needs no
per-collection tables and no migrations when a collection's shape changes. It
resembles an entity-attribute-value store, partitioned by primitive type: typed
`store_*` tables give proper column types, indexability, and full-text / GIN
indexing — a meaningful advantage over a single JSONB-per-document blob. A custom
path notation (`content.1.photoBlock.display`) addresses each value, and the
storage layer flattens documents into rows on write and reconstructs them on
read.

For the full treatment — data model, benchmarks, and risks — see
[Document Storage](./01-document-storage.md).

## 2. Immutable versioning

Every save writes a new document version (UUIDv7, time-ordered) rather than
mutating in place. This gives version history and audit trails for free; a
`ROW_NUMBER() OVER PARTITION` view resolves the current version per document.

See [Document Storage → Versioning](./01-document-storage.md#versioning) for the
document-versioning runtime, and [Collection Versioning](../04-collections/08-collection-versioning.md)
for the *schema*-versioning track that records which schema shape each document
was authored against.

## 3. Document level vs version level

Not everything about a document changes at the same rate, and Byline stores state
at two distinct levels to match:

- **Version level — content.** Every field value lives in the version stream.
  Editing content mints a new immutable `documentVersions` row (decision 2);
  nothing is overwritten.
- **Document level — identity and placement.** A few system attributes belong to
  the *logical document* rather than to any one version, and are **sticky across
  versions**:
  - `path` — the document's URL slug (`byline_document_paths`); see
    [Document Paths](../04-collections/05-document-paths.md).
  - `availableLocales` — the editorial set of advertised content locales
    (`byline_document_available_locales`); see
    [Content locales](../07-internationalization/03-content-locales.md).
  - the **tree edge** — the document's single parent and its order among siblings
    (`byline_document_relationships`); see
    [Document Trees](../04-collections/04-document-trees.md).

Document-level fields are written by dedicated, **non-versioned** commands
(`updateDocumentPath`, `setDocumentAvailableLocales`, `placeTreeNode`) that mint
no version and don't reset workflow status. The write is immediate and applies
across every version of the document.

The reason is that these attributes describe *where a document is and how it's
reached*, not *what it says*. A path, a tree position, or an advertised-locale set
cannot honestly be "pending publish" — there is no per-version copy to stage.
Coupling them to the publish workflow would reset the document to draft on a
purely structural move and imply a staging step that never existed: the editorial
write already lands at save time. Keeping them at document level makes the data
model and the UX agree — re-parenting a document, fixing a slug, or toggling a
locale is an immediate metadata edit, much like renaming a file.

| Concern | Level | Storage | Written by | In version history? |
|---|---|---|---|---|
| Field content | version | `store_*` | `createDocumentVersion` | ✅ each edit is a version |
| Workflow status | version (in place) | `documentVersions.status` | `changeDocumentStatus` | partial — current value only |
| `path` | document | `byline_document_paths` | `updateDocumentPath` | ❌ non-versioned |
| `availableLocales` | document | `byline_document_available_locales` | `setDocumentAvailableLocales` | ❌ non-versioned |
| tree edge (parent + order) | document | `byline_document_relationships` | `placeTreeNode` | ❌ non-versioned |

**This split is the architectural reason the audit log exists.** Versioning
already makes *content* changes fully accountable — each is an immutable, diffable
version. But document-level writes (and in-place status transitions) deliberately
sit outside the version stream, so they leave no version to point at.
Accountability for them is the job of the document-level
[audit log](../06-auth-and-security/02-auditability.md): every non-versioned
mutation records who changed what, when, and from→to — written in the *same*
transaction as the change itself (see [Transactions](./03-transactions.md)) so a
change can never commit without its audit row. Versioning covers the content; the
audit log covers everything that changes outside it. Together they make *every*
change accountable.

## 4. Patch-based updates

The admin client accumulates a `DocumentPatch[]` and applies it server-side
against the reconstructed document. Three patch families — field, array, and
block — cover the essential operations, and the patch model is a foundation for
future collaborative editing (OT/CRDT).

Patches are admin-form internal; public writes go whole-document. See
`packages/core/src/patches/` for the implementation and
[Client SDK → Write surface](../05-reading-and-delivery/01-client-sdk.md#write-surface)
for the public write contract.

## 5. Schema and presentation are separate systems

A collection's **schema** (what it *is*) is defined separately from its **admin
config** (how it *renders*), with the admin config referencing the schema:

```ts
// collections/pages/schema.ts  (server-safe, no UI concerns)
import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

export const Pages: CollectionDefinition = {
  path: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  useAsTitle: 'title',
  // `path` is a reserved system attribute (stored in byline_document_paths);
  // opt into automatic derivation by naming the source field with useAsPath.
  useAsPath: 'title',
  // `availableLocales` is likewise a reserved system attribute; opt in here and
  // core renders the available-locales sidebar widget (not layout-addressable).
  advertiseLocales: true,
  search: { fields: ['title'] },
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    { name: 'content', label: 'Content', type: 'richText', localized: true },
    { name: 'publishedOn', label: 'Published On', type: 'datetime', mode: 'datetime' },
    { name: 'featured', label: 'Featured', type: 'checkbox', optional: true },
  ],
}
```

```tsx
// collections/pages/admin.tsx  (client-safe, presentation only)
import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'
import { DateTimeFormatter } from '@byline/admin/react'

import { Pages } from './schema.js'

const listViewColumns: ColumnDefinition[] = [
  { fieldName: 'title', label: 'Title', sortable: true, align: 'left', className: 'w-[30%]' },
  {
    fieldName: 'featured',
    label: 'Featured',
    align: 'center',
    formatter: (value) => (value ? '★' : ''),
  },
  { fieldName: 'status', label: 'Status', align: 'center' },
  {
    fieldName: 'updatedAt',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    formatter: { component: DateTimeFormatter },
  },
]

export const PagesAdmin: CollectionAdminConfig = defineAdmin(Pages, {
  columns: listViewColumns,
  layout: {
    // 'main' / 'sidebar' accept schema field names and named layout primitives
    // (tabSets, rows, groups). The 'path' widget is form chrome rendered
    // structurally from the schema's useAsPath — it is NOT addressable here.
    main: ['title', 'content'],
    sidebar: ['publishedOn', 'featured'],
  },
})
```

:::note[Schema-level fields]
`useAsTitle`, `search`, and `workflow` live on the schema (not the admin
config) because they describe the document itself, not how it's rendered.
`useAsTitle` names the field that represents a document's identity — used
by the relation picker summary, populate's default projection, and any
other server-side consumer. It is analogous to Django's `Model.__str__`.
:::

The split pays off in several ways:

- Schema definitions are server-safe and UI-free, but isomorphic: the server and
  browser admin consume the same plain data. Server lifecycle loaders therefore
  need the host framework's server-only boundary, while admin blocks and client
  components stay in admin config. The schema remains serializable, testable,
  and publishable as an API contract.
- Admin config can use real JSX and real imports, because it is explicitly a
  client (or RSC) module — no string indirection.
- The schema can be consumed by other frontends (mobile, CLI tools, external
  APIs) without dragging admin UI dependencies along.
- Type-safety improves: `defineAdmin(Pages, …)` infers field names from the
  schema and offers autocomplete for UI overrides.

The cost:

- Two files instead of one (or two declarations in one file).
- A linking step so the framework knows which admin config belongs to which
  schema — `defineAdmin(schema, …)`, which sets the admin config's slug from
  `schema.path` automatically.
- It is harder to see the whole picture of a single collection at a glance.

See [Collections](../04-collections/index.md) for the full collection-level
reference (columns, layout primitives, preview URL, custom list views) and
[Fields](../04-collections/01-fields.md) for the same split applied at the field
level (component slots, helper factories, the per-field richtext editor swap).

### Prior art for this split

This mirrors a pattern several mature frameworks settled on independently:

- **Django** separates models (schema) from `ModelAdmin` (admin presentation) —
  one of its most praised decisions.
- **Rails** ActiveAdmin / Administrate separate resource definitions from their
  admin dashboard configuration.
- **Sanity Studio v3** defines schema types separately from desk structure, with
  custom inputs as real React components rather than string references.
- **Keystatic** separates schema from its reader and admin UIs.

## 6. Authentication and authorization

A typed actor / `RequestContext` model threads through every read and write path.
Service-layer enforcement asserts collection abilities on the write side, and the
`beforeRead` collection hook AND-merges a per-actor `QueryPredicate` into the same
SQL machinery the public client uses.

For the full story — including six worked `beforeRead` recipes (owner-only
drafts, multi-tenant scoping, embargo, soft-delete hide, department visibility,
self-only) — see [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md).
