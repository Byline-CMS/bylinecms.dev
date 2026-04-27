# Key Architectural Decisions

These are the load-bearing design decisions behind Byline. Each is described
in more depth in the matching analysis document under
[`docs/analysis/`](./analysis/README.md).

## 1. Universal Storage (Inverted Index / EAV-per-type)

One of our experiments in this effort is the creation of a general purpose
storage model that does not require per-collection schema deployments or
migrations regardless of collection shape. It is similar to an
Entity-Attribute-Value store partitioned by type. Our typed `store_*` tables
give us proper column types, indexability, and future full-text/GIN indexing —
which we feel is a significant advantage over a single JSONB-per-document
approach. We use a custom store path notation (`content.1.photoBlock.0.display`)
as our addressing scheme for 'flattening' and 'reconstructing' documents.

For a deep dive — including the strategic analysis, benchmarks, and roadmap —
see [STORAGE-ANALYSIS](./analysis/STORAGE-ANALYSIS.md).

## 2. Immutable Versioning

We save document versions by default (UUIDv7 time-ordered). This gives us
built-in version history, enables eventual audit trails, and avoids in-place
mutation. We use `ROW_NUMBER() OVER PARTITION` for resolving "latest" versions.

See [COLLECTION-VERSIONING-ANALYSIS](./analysis/COLLECTION-VERSIONING-ANALYSIS.md).

## 3. Patch-Based Updates

We accumulate `DocumentPatch[]` on the client and apply them server-side
against the reconstructed document. Three patch families (field, array, block)
cover the essential operations. We also feel our patch-based strategy is a
good foundation for future collaborative editing (OT/CRDT).

## 4. Schema and Presentation Are Separate Systems

We're fairly sure that splitting schema from presentation concerns is the
right way to go. The core idea is to have schema/data config defined
separately from admin UI config (which references the schema). Something like
this:

```ts
// collections/pages/schema.ts  (server-safe, no UI concerns)
import type { CollectionDefinition } from '@byline/core'
import { defineWorkflow } from '@byline/core'

import { availableLanguagesField } from '~/fields/available-languages-field.js'

export const Pages: CollectionDefinition = {
  path: 'pages',
  labels: { singular: 'Page', plural: 'Pages' },
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  useAsTitle: 'title',
  // `path` is a reserved system attribute on documentVersions; opt into
  // automatic derivation by naming the source field with useAsPath.
  useAsPath: 'title',
  search: { fields: ['title'] },
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    { name: 'content', label: 'Content', type: 'richText', localized: true },
    { name: 'publishedOn', label: 'Published On', type: 'datetime', mode: 'datetime' },
    { name: 'featured', label: 'Featured', type: 'checkbox', optional: true },
    availableLanguagesField(),
  ],
}
```

```tsx
// collections/pages/admin.tsx  (client-safe, presentation only)
import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'

import { DateTimeFormatter } from '@/ui/fields/date-time-formatter.js'
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
    fieldName: 'updated_at',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    formatter: { component: DateTimeFormatter },
  },
]

export const PagesAdmin: CollectionAdminConfig = defineAdmin(Pages, {
  columns: listViewColumns,
  fields: {
    path: { position: 'sidebar' },
    availableLanguages: { position: 'sidebar' },
    publishedOn: { position: 'sidebar' },
    featured: { position: 'sidebar' },
  },
})
```

> `useAsTitle`, `search`, and `workflow` live on the schema (not the admin
> config) because they describe the document itself, not how it's rendered.
> `useAsTitle` names the field that represents a document's identity — used
> by the relation picker summary, populate's default projection, and any
> other server-side consumer. Analogous to Django's `Model.__str__`.

The advantages of this approach:

- Schema definitions become truly server-only — no import-map strings, no
  admin blocks, no client components anywhere near them. They're plain data,
  trivially serializable, testable, and publishable as an API contract.
- Admin UI config can use real JSX and real imports because it's explicitly a
  client (or RSC) module. No string indirection needed.
- The schema can be consumed by other frontends (mobile, CLI tools, external
  APIs) without dragging admin UI baggage along.
- Type-safety improves: `defineAdmin(PagesSchema, ...)` can infer field names
  from the schema and offer autocomplete for UI overrides.

What it costs:

- Two files instead of one (or two declarations in a single file — though
  this is arguably better separation of concerns).
- A "linking" mechanism is needed so the framework knows which admin config
  belongs to which schema.
- Harder to see "the whole picture" at a glance for a single collection.

### Prior art for this split

- **Django** does exactly this: models (schema) are separate from `ModelAdmin`
  (admin site presentation). It's one of Django's most praised architectural
  decisions.
- **Rails ActiveAdmin / Administrate**: resource definitions are separate from
  their admin "dashboard" configuration.
- **Sanity Studio v3**: schema types are defined separately from "desk
  structure" (how the admin UI organizes and presents them). Custom input
  components are real React components, not string references.
- **Keystatic**: schema and UI ("reader" vs "admin") are somewhat separated by
  design.

## 5. Authentication and Authorization

A typed actor / `RequestContext` model threads through every read and write
path. Service-layer enforcement asserts collection abilities on the write
side; the `beforeRead` collection hook AND-merges per-actor `QueryPredicate`s
into the same SQL machinery the public client uses.

For the full story, see [AUTHN-AUTHZ-ANALYSIS](./analysis/AUTHN-AUTHZ-ANALYSIS.md)
and the worked recipes in [ACCESS-CONTROL-RECIPES](./analysis/ACCESS-CONTROL-RECIPES.md).
