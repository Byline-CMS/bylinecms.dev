---
title: "Collections"
path: "collections"
summary: "Defining collections in Byline: defineCollection, the workflow system, lifecycle hooks (beforeCreate, beforeRead, afterUpdate…), and the admin presentation split."
---

# Collections

Companions:
- [FIELDS.md](./FIELDS.md) — field-level schema and admin (slot components, helper factories, the per-field richtext editor swap).
- [RICHTEXT.md](./RICHTEXT.md) — the Lexical adapter, its `EditorConfig`, and per-field overrides.
- [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — auth + access-control subsystem, including six worked `beforeRead` row-scoping recipes (owner-only drafts, multi-tenant, soft-delete, …).
- [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — *document* versioning (the sibling pillar — this doc covers *schema* versioning).
- [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md) — how `useAsPath` lands in `byline_document_paths`.

## Overview

A collection is the unit of authoring in Byline. Like a Django model with its `ModelAdmin`, it lives in two places: a **schema** that declares what the collection *is* (`CollectionDefinition`, returned by `defineCollection`), and an **admin** that declares how it *renders* in the dashboard (`CollectionAdminConfig`, returned by `defineAdmin`). The two are linked by the schema's `path`. This doc is the working reference for both halves, plus the **schema-versioning** layer that records, on every document save, the integer schema version the document was authored against.

```
schema.ts                            admin.tsx
─────────                            ────────
defineCollection({                   defineAdmin(News, {
  path: 'news',                        columns,
  fields: [...],                       picker,
  useAsTitle,                          tabSets / rows / groups / layout,
  workflow,                            preview.url,
  hooks,                               listView,
  ...                                  fields: { … per-field admin },
})                                   })
```

Both halves are co-located under `apps/webapp/byline/collections/<name>/`. The schema must stay **tsx-loadable** (no React, no CSS modules, no browser-only imports) so seeds and the server bootstrap can import it under raw `tsx`. The admin lives inside the Vite-managed admin module graph and may pull in React freely.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section.

### 1. Define a collection (schema)

The minimum: a `path`, `labels`, and a `fields[]` array.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import { defineCollection } from '@byline/core'

export const News = defineCollection({
  path: 'news',
  labels: { singular: 'News', plural: 'News' },
  useAsTitle: 'title',
  useAsPath: 'title',
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'content', type: 'richText' },
  ],
})
```

→ [The CollectionDefinition surface](#the-collectiondefinition-surface)

### 2. Define the admin config

`defineAdmin(schema, …)` links the admin config to its schema via the schema's `path`. Without an admin config the renderer synthesises a default that places every field in `main` in declaration order.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
import { defineAdmin } from '@byline/core'
import { News } from './schema.js'

export const NewsAdmin = defineAdmin(News, {
  // …columns, layout, fields, preview, listView, …
})
```

→ [The CollectionAdminConfig surface](#the-collectionadminconfig-surface)

### 3. Set list-view columns

Columns control which fields appear in the default table-based `ListView`. Each column maps to a field name (or top-level metadata like `status` / `updatedAt`) and accepts a label, sort flag, alignment, className, and a `formatter` (function or `{ component }`).

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
import type { ColumnDefinition } from '@byline/core'
import { DateTimeFormatter } from '@byline/admin/react'

const columns: ColumnDefinition[] = [
  { fieldName: 'title', label: 'Title', sortable: true, align: 'left' },
  { fieldName: 'status', label: 'Status', align: 'center' },
  {
    fieldName: 'updatedAt',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    formatter: { component: DateTimeFormatter },
  },
]

defineAdmin(News, { columns })
```

→ [Columns and picker](#columns-and-picker)

### 4. Set picker columns

When this collection appears as the target of a relation picker (e.g. `News.featureImage → Media`), the picker renders one row per result. `picker` columns give that row a tailored layout — typically narrower than the list view. Omit to fall back to `useAsTitle` + `path` on one line.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
const pickerColumns: ColumnDefinition[] = [
  { fieldName: 'image', label: 'Preview', formatter: { component: MediaThumbnail } },
  { fieldName: 'title', label: 'Title' },
  { fieldName: 'status', label: 'Status' },
]

defineAdmin(Media, { picker: pickerColumns })
```

→ [Columns and picker](#columns-and-picker)

### 5. Group fields into tabs, rows, and groups

Layout primitives are *named* and referenced by name from `layout.main` / `layout.sidebar`. `tabSets` create tabbed interfaces; `rows` flow fields side-by-side; `groups` wrap fields in a labelled fieldset.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
defineAdmin(News, {
  tabSets: [
    {
      name: 'main',
      tabs: [
        { name: 'details', label: 'Details', fields: ['title', 'summary', 'category'] },
        { name: 'content', label: 'Content', fields: ['content'] },
      ],
    },
  ],
  rows: [{ name: 'titleRow', fields: ['title', 'subtitle'] }],
  groups: [{ name: 'meta', label: 'Metadata', fields: ['publishedOn', 'titleRow'] }],
})
```

→ [Layout primitives](#layout-primitives)

### 6. Compose layout: main + sidebar

`layout` is the composition step — it places the named primitives (and bare schema field names) into the two render regions of the edit form.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
defineAdmin(News, {
  layout: {
    main: ['main'],                                 // the 'main' tabSet from recipe 5
    sidebar: ['category', 'publishedOn'], // bare field names in the sidebar
  },
})
```

→ [Layout primitives](#layout-primitives)

### 7. Define a preview URL

`preview.url(doc, ctx)` returns the URL the admin's preview button opens. Return `null` to hide the preview button (e.g. unsaved draft, missing required relation).

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
defineAdmin(News, {
  preview: {
    url: (doc, { locale }) => {
      if (!doc.path) return null
      // `category` is a direct relation — auto-populated to depth 1.
      const category = doc.fields.category?.document?.path
      const prefix = locale && locale !== 'en' ? `/${locale}` : ''
      return category
        ? `${prefix}/news/${category}/${doc.path}`
        : `${prefix}/news/${doc.path}`
    },
  },
})
```

→ [Preview URL](#preview-url)

### 8. Replace with a custom list view

`listView` completely replaces the default table. The component receives a `ListViewComponentProps` and is responsible for search, ordering, results, and pagination. Use for non-tabular layouts (card grids, kanban, calendar).

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx` + `apps/webapp/byline/collections/<name>/components/<your-view>.tsx`

```ts
import { MediaListView } from './components/media-list-view.js'

defineAdmin(Media, { listView: MediaListView })
```

→ [Custom list view (MediaListView walkthrough)](#custom-list-view-medialistview-walkthrough)

### 9. Configure workflow

`defineWorkflow` guarantees `draft` / `published` / `archived` are present and correctly ordered. Customise the labels and verbs per-collection, or add bespoke statuses if the standard three aren't enough.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import { defineCollection, defineWorkflow } from '@byline/core'

export const News = defineCollection({
  path: 'news',
  workflow: defineWorkflow({
    draft: { label: 'Draft', verb: 'Revert to Draft' },
    published: { label: 'Published', verb: 'Publish' },
    archived: { label: 'Archived', verb: 'Archive' },
  }),
  fields: [/* … */],
})
```

→ [Workflow](#workflow)

### 10. Enable drag-to-reorder

Opt in to fractional-index ordering. The list view sorts by `order_key` ascending and exposes a drag handle on each row. New documents (and duplicates) get an append-at-end key automatically.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const TeamMembers = defineCollection({
  path: 'team-members',
  labels: { singular: 'Team Member', plural: 'Team Members' },
  useAsTitle: 'name',
  orderable: true,
  fields: [/* … */],
})
```

SDK callers reading an orderable collection request the sort explicitly:

```ts
const members = await client
  .collection('team-members')
  .find({ sort: { orderKey: 'asc' } })
```

→ [Orderable collections](#orderable-collections)

### 11. Pin a collection version

By default, any data-affecting schema change auto-bumps the stored `collection.version`. Pin a value explicitly to align versions across environments or to reserve a round number for a planned major change.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
export const News = defineCollection({
  path: 'news',
  version: 3, // pinned — must be >= stored version, or boot throws.
  fields: [/* … */],
})
```

→ [Version-bump policy](#version-bump-policy)

### 12. Read `collection_version` from a document

Every `documentVersions` row carries the integer `collection_version` it was authored against. Surfaced on both `current_documents` and `current_published_documents` views, and on every API response shape.

```ts
const doc = await client.collection('news').findById(id)
console.log(doc.collectionVersion)  // 3
```

What you cannot do *yet*: ask the server to render that document against the historical schema. Reads still use the live `CollectionDefinition` regardless of `collectionVersion`. See [Boundary](#boundary--what-does-not-read-by-version-yet).

→ [Versioning](#versioning)

---

## Architecture

### The schema / admin split

A collection lives in two files:

- **Schema** (`collections/<name>/schema.ts`) — a `CollectionDefinition` returned by `defineCollection`. Pure data: `path`, `labels`, `fields[]`, `useAsTitle`, `useAsPath`, `workflow`, `hooks`, `search`, `showStats`, `linksInEditor`, `orderable`, `version`. **Must be tsx-loadable** — the server bootstrap in `apps/webapp/byline/server.config.ts` imports schemas directly so seeds and migrations can run outside Vite. No React. No CSS modules. No browser-only globals.
- **Admin** (`collections/<name>/admin.tsx`) — a `CollectionAdminConfig` returned by `defineAdmin`. UI overrides: `columns`, `picker`, `tabSets` / `rows` / `groups` / `layout`, `preview.url`, `listView`, `fields{}` (per-field admin), `group`. React, CSS modules, and Vite-managed imports are all fine.

The split mirrors Django's `Model` / `ModelAdmin`. The same field names appear on both sides — the schema declares what the field *is*; the admin declares how it *renders*. The two halves are linked by the schema's `path` (`defineAdmin(schema, …)` sets `slug` from `schema.path` automatically). See [FIELDS.md](./FIELDS.md) for the equivalent split at the field level.

### The `CollectionDefinition` surface

```ts
// packages/core/src/@types/collection-types.ts (excerpt)
export interface CollectionDefinition {
  labels: { singular: string; plural: string }
  path: string
  fields: Field[]
  workflow?: WorkflowConfig
  hooks?: CollectionHooks
  search?: { fields: string[] }
  useAsTitle?: string
  useAsPath?: string
  linksInEditor?: boolean
  showStats?: boolean
  orderable?: boolean
  version?: number
}
```

**Properties that matter day-to-day:**

| Property | Effect |
|---|---|
| `path` | The collection's URL slug + storage key. Must be unique. Drives `collection_path` in storage and the admin route. |
| `labels` | Display strings for the admin shell (sidebar, breadcrumbs, "New X" buttons). |
| `fields` | Schema-side field definitions. See [FIELDS.md](./FIELDS.md) for the field-level model. |
| `useAsTitle` | The field whose value is the document's single-line label — form heading, relation widget summary, populate's default projection, log lines. Analogous to Django's `Model.__str__`. |
| `useAsPath` | The field whose value initialises a document's `path` row in `byline_document_paths`. Slugified once; sticky after creation. Collections without `useAsPath` receive a UUID path. See [DOCUMENT-PATHS.md](./DOCUMENT-PATHS.md). |
| `workflow` | Sequential workflow config — see [Workflow](#workflow). Defaults to a standard `draft` → `published` → `archived` triple. |
| `hooks` | Lifecycle hooks (server-side). See [Lifecycle hooks](#lifecycle-hooks). |
| `search` | Field names included in the admin list view's search box. Only `store_text` fields are supported today. Defaults to `{ fields: ['title'] }`. |
| `linksInEditor` | When `true`, this collection's documents appear as linkable options inside the richtext editor's link plugin. Requires `useAsTitle`. |
| `showStats` | When `true`, the admin landing page renders per-status counts inside this collection's card. Costs one DB round-trip per landing render — opt in deliberately. |
| `orderable` | When `true`, documents carry a fractional-index `order_key` and the list view sorts by it ascending with drag-to-reorder. See [Orderable collections](#orderable-collections). |
| `version` | Optional version pin. Omit to let the bootstrap auto-bump on schema change. See [Version-bump policy](#version-bump-policy). |

`path` is reserved — `path` (top-level metadata, populated from `useAsPath`) is not a user-defined field and cannot be declared on `fields[]`.

### The `CollectionAdminConfig` surface

```ts
// packages/core/src/@types/admin-types.ts (excerpt)
export interface CollectionAdminConfig<T = any> {
  slug: string                           // set automatically by defineAdmin
  group?: string                         // sidebar grouping
  columns?: ColumnDefinition<T>[]        // default list view
  picker?: ColumnDefinition<T>[]         // relation picker rows
  defaultColumns?: string[]
  tabSets?: TabSetDefinition[]
  rows?: RowDefinition[]
  groups?: GroupDefinition[]
  layout?: LayoutDefinition              // { main, sidebar? }
  fields?: Record<string, FieldAdminConfig>
  preview?: { url: (doc, ctx) => string | null }
  listView?: (props: ListViewComponentProps) => any
}
```

The four major slot areas are: **columns** (list view + relation picker), **layout** (tabs / rows / groups composed into main/sidebar), **preview** (the preview URL builder), and **listView** (the custom-component escape hatch). Per-field admin lives in `fields{}` and is documented in [FIELDS.md](./FIELDS.md).

### Columns and picker

A `ColumnDefinition` maps a field name (or a top-level column like `status` / `updatedAt`) to a column header. The shape is the same for both `columns` (list view) and `picker` (relation picker rows), so formatters and helpers are reusable across both.

```ts
export interface ColumnDefinition<T = any> {
  fieldName: keyof T
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  className?: string
  formatter?: ColumnFormatter<T>
}

export type ColumnFormatter<T = any> =
  | ((value: any, record: T) => any)
  | { component: (props: FormatterProps<T>) => any }
```

**Formatter forms.** The plain-function form is fine for one-line transformations. The `{ component }` form gives you a real React component for the cell — hooks, context, conditional rendering all work. Built-ins like `DateTimeFormatter` and project-local components like `MediaThumbnail` use this form.

**Picker columns.** When omitted, the relation picker falls back to a single-line render of `useAsTitle` + `path`. Define `picker` when you want a tailored row for one of your collections appearing as a relation target — typically narrower than the list-view columns. See `apps/webapp/byline/collections/media/admin.tsx` for the canonical example.

### Layout primitives

Layout primitives are *named* registries (`tabSets[]`, `rows[]`, `groups[]`) that compose into the form's two render regions via `layout.main` and `layout.sidebar`. Membership is owned by the primitive — fields list themselves once, inside the primitive's `fields[]` array.

| Primitive | Accepts | Renders as |
|---|---|---|
| `tabSets[]` | tabs each holding schema-field, row, or group names | One tab bar. Only valid in `layout.main`. |
| `rows[]` | schema-field names only (leaf container) | Side-by-side flex row; stacks vertically below `sm`. |
| `groups[]` | schema-field names + row names | Labelled `<fieldset>` with optional `label`. |

**Nesting rules** (enforced by the startup validator, not the type system):

- `tabSets` only appear in `layout.main`.
- Rows are leaves — no nested rows / groups / tabs.
- Groups accept fields and rows, but no tabs and no nested groups.
- Tabs accept fields, rows, and groups.

**Tab visibility.** Each tab can carry an optional `condition: (data) => boolean`. The form re-evaluates on every keystroke (via the meta-subscribe loop) so tabs appear / disappear based on live data. Client-only — must not be placed on `CollectionDefinition`.

**Composition.** `layout` is the entry point. `main` accepts tabSet, group, row, or schema-field names. `sidebar` accepts group, row, or schema-field names (no tabSets). When `layout` is omitted entirely, the renderer synthesises `{ main: <all schema field names in order> }` so trivial collections render with sensible defaults.

**Name collisions are a startup error.** Names for tabSets, rows, and groups must be unique and must not collide with any schema field name. A name collision throws before the process accepts traffic.

**The `path` widget.** Form chrome rendered structurally by the form renderer based on `useAsPath`. It is **not** addressable from `layout` — admin configs cannot reference `'path'`.

### Preview URL

```ts
preview?: {
  url: (doc: PreviewDocument<T>, ctx: { locale?: string }) => string | null
}
```

`preview.url` returns the URL the admin's preview button opens, or `null` to hide the preview affordance entirely (missing path, missing required relation, draft awaiting first save, …).

**What's available on `doc`:**

- **Top-level columns** — `id`, `path`, `status`. `path` is the slug derived server-side from `useAsPath`; it is a reserved column on every document, not a user-defined field. Address as `doc.path`, not `doc.fields.path`.
- **Field values** — under `doc.fields`. Every scalar / array / block field of the source collection.
- **Direct relation targets** — under `doc.fields.<name>?.document`. The edit-view loader applies a blanket depth-1 populate so relation tiles render with target data on first paint, and `url(...)` inherits the same populated tree. The projection follows the target's `picker` columns (plus top-level columns like `path`, which are always present). Deeper hops are NOT populated.

```ts
preview: {
  url: (doc, { locale }) => {
    if (!doc.path) return null
    const category = doc.fields.category?.document?.path  // depth-1 populate
    const prefix = locale && locale !== 'en' ? `/${locale}` : ''
    return category
      ? `${prefix}/news/${category}/${doc.path}`
      : `${prefix}/news/${doc.path}`
  },
}
```

Returned URLs may be relative (`/news/foo`) for same-origin hosts or absolute (`https://example.com/news/foo`) for hosts deployed separately from the admin.

**Default behaviour.** When `preview` is omitted, the preview link defaults to `/${collectionPath}/${doc.path}` — fine for collections whose public URL mirrors the collection path.

**Why no `preview.populate` hint.** Prototyped and removed. The edit-view loader already issues a depth-1 populate to render relation tiles, so any selective override would have to coexist with the picker projection (additive? overriding? both?) — extra surface area for a case no current collection needs. Revisit if a real use case emerges (deeper relation traversal, or a field outside the picker projection that the URL builder needs).

### Custom list view (`MediaListView` walkthrough)

`listView` is the primary extensibility point for non-tabular layouts: card grids, kanban boards, calendar views. When provided, it completely replaces the default table-based `ListView` on the collection's index route. It receives a `ListViewComponentProps` and is responsible for rendering search, ordering, results, and pagination itself — no additional API parameters or endpoints needed.

```ts
export interface ListViewComponentProps<TData = any> {
  data: TData                                // paginated API response: { docs, meta, included }
  workflowStatuses?: WorkflowStatus[]
}
```

The `data` shape mirrors the standard paginated API envelope (`AnyCollectionSchemaTypes['ListType']` in the webapp). It carries the paginated documents, pagination meta, and the `included` block with collection metadata. Search, ordering, and pagination flow through URL params (`?query=…`, `?order=…`, `?desc=…`, `?page=…`) and the component drives them via TanStack Router's `useNavigate` + `useRouterState`.

**Worked example — `MediaListView`** (in `apps/webapp/byline/collections/media/components/media-list-view.tsx`). The Media collection ships a card-grid replacement for the table:

```tsx
import { useNavigate, useRouterState } from '@tanstack/react-router'
import type { ListViewComponentProps, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'

export function MediaListView({
  data,
  workflowStatuses = [],
}: ListViewComponentProps<AnyCollectionSchemaTypes['ListType']>) {
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })
  const collectionPath = data.included.collection.path
  const search = location.search as Record<string, any>

  // Drive search via the ?query= URL param.
  const handleOnSearch = (query: string) => {
    const params = structuredClone(search)
    delete params.page                    // reset to first page on new search
    params.query = query
    navigate({
      to: '/admin/collections/$collection',
      params: { collection: collectionPath },
      search: params,
    })
  }

  // …order-by handler, pagination handler in the same shape…

  return (
    <Section>
      <Container>
        <Search onSearch={handleOnSearch} onClear={handleOnClear} />
        <RouterPager page={data.meta.page} count={data.meta.totalPages} />
        <div className={styles.grid}>
          {data.docs.map((doc) => (/* …card UI… */))}
        </div>
        <RouterPager smoothScrollToTop page={data.meta.page} count={data.meta.totalPages} />
      </Container>
    </Section>
  )
}
```

**Key patterns:**

- **URL is the source of truth for search / order / page.** The view reads the current values from `useRouterState().location.search`, and changes write back via `useNavigate({ search })`. No local state for these — refreshes and shareable links work for free.
- **Reset `page` on any other change.** A new search or new ordering should land on page 1; carrying over `?page=4` to a new query yields confused empty pages.
- **Pagination via `RouterPager`** from `@byline/host-tanstack-start/admin-shell/chrome/router-pager`. It writes `?page=…` and (optionally) smooth-scrolls back to the top — matching the default list view's behaviour.
- **`columns` definitions are still importable** even when `listView` is set; they aren't *applied* automatically (that's the default `ListView`'s job), but a custom view can opt in — for example to render a togglable grid/table view from the same column schema.

Register the view on the admin config:

```ts
defineAdmin(Media, { listView: MediaListView })
```

### Workflow

Every collection has a sequential workflow — by default `draft` → `published` → `archived`. The transition validator allows ±1 step or reset-to-first. Customise per collection by passing `defineWorkflow(...)` on the schema:

```ts
import { defineWorkflow } from '@byline/core'

workflow: defineWorkflow({
  draft: { label: 'Draft', verb: 'Revert to Draft' },
  published: { label: 'Published', verb: 'Publish' },
  archived: { label: 'Archived', verb: 'Archive' },
})
```

`defineWorkflow` guarantees the three base statuses are present and correctly ordered. Bespoke statuses (e.g. `inReview`) can be added between the base ones. Workflow status `label` and `verb` are presentational and **excluded from the schema fingerprint** — see [Fingerprint](#fingerprint).

Status changes mutate the existing version row in-place — they are lifecycle metadata, not content. The Zod schema builder derives the status enum dynamically from each collection's workflow.

### Lifecycle hooks

`CollectionHooks` on `CollectionDefinition` provides server-side lifecycle hooks for documents in the collection. Each hook accepts a single function or an array of functions executed sequentially.

| Phase | Hooks |
|---|---|
| Create | `beforeCreate`, `afterCreate` |
| Update | `beforeUpdate`, `afterUpdate` |
| Delete | `beforeDelete`, `afterDelete` |
| Status change | `beforeStatusChange`, `afterStatusChange` |
| Unpublish | `beforeUnpublish`, `afterUnpublish` |
| Read | `beforeRead` (row-scoping predicate), `afterRead` (per-document mutation) |

**`beforeRead`** is the row-scoping hook. It runs once per `findDocuments` call (and once per populate batch, per target collection), **before** any DB work, and returns a `QueryPredicate` that the query layer ANDs onto the caller's `where`. Use it for multi-tenant scoping, owner-only-drafts, soft-delete hide, etc. See [AUTHN-AUTHZ.md — Read-side scoping](./AUTHN-AUTHZ.md#read-side-scoping--the-beforeread-hook) for the full reference, and the Quick Reference there for six worked recipes.

**`afterRead`** runs once per materialised document on every read path that flows through `@byline/client` or `populateDocuments`. Can mutate `ctx.doc.fields` in place; mutations propagate through the response. Fires after populate on the source document, so hooks see the fully populated tree. Hooks that perform their own reads should thread `ctx.readContext` through to preserve the visited set and read budget (A→B→A safety).

Server-side **upload** hooks (`beforeStore` / `afterStore`) live on the field's `upload` block — not on the collection — because they are field-scoped and field-aware. A collection with multiple image/file fields runs each field's pipeline independently.

### Orderable collections

`orderable: true` is an opt-in fractional-index column on `byline_documents.order_key` that lets editors drag rows in a collection's list view to define a canonical order. Useful for short, finite, naturally ordered collections — bios, team members, FAQ items, news categories, navigation sections — where alphabetical or `createdAt` ordering doesn't tell the right story.

**Three rules anchor the model:**

1. **Opt-in per collection.** `defineCollection({ orderable: true })`. Off by default; nothing changes for collections that don't opt in.
2. **System metadata, not content.** `order_key` lives on the logical-document row (`byline_documents.order_key`), not on `documentVersions`. Reordering does **not** create a new document version, does **not** flow through patches, and does **not** trigger collection write hooks.
3. **Fractional-index, no rebalancing.** Keys are base-62 strings that sort lexicographically (Greenspan's algorithm, [Observable article](https://observablehq.com/@dgreensp/implementing-fractional-indexing)). Inserting between two rows produces a new string strictly between their keys — no rebalancing pass, no global re-write.

`orderable` lives on the schema (not on `defineAdmin`) because it has structural consequences across layers — `document-lifecycle` appends a key on create, the reorder server fn gates on it, and the `@byline/client` SDK can sort by it without crossing into presentation config.

**Effects when `orderable: true`:**

- List-view default sort becomes `order_key` ascending. Callers can still re-sort by any other column with the column-header sort UI; that disables drag-to-reorder until the sort is cleared.
- A drag-handle column appears on the left of each row in the list view.
- New documents (and duplicates) get an append-at-end `order_key` automatically.
- The `reorderCollectionDocument` server fn becomes meaningful for this collection; it rejects with `ERR_VALIDATION` on non-orderable collections.

**Where it lives:**

| Concern | Where |
|---|---|
| The column | `byline_documents.order_key varchar(128) NULL` |
| The sort index | `idx_documents_collection_order` on `(collection_id, order_key)` |
| Append-at-end on create / duplicate | `document-lifecycle.ts` → `maybeAppendOrderKey` |
| Drag-to-reorder UI | `host-tanstack-start/admin-shell/collections/list.tsx` |
| Reorder API | `host-tanstack-start/server-fns/collections/reorder.ts` |
| Key generator | `@byline/core` → `generateKeyBetween`, `generateNKeysBetween` |
| Default sort wiring | `getCollectionDocuments` (list server fn) consults `definition.orderable` |
| Sort allowlist | `DOCUMENT_SORT_COLUMNS` in `parse-where.ts` (`orderKey` / `order_key`) |

**Why a column on `byline_documents`, not elsewhere.**

- **Not per-version (`documentVersions`)** — reordering 50 rows shouldn't mint 50 versions, and if draft and published versions diverged there's no sensible "which version's order wins?" Order is single-valued per logical document.
- **Not EAV** — the EAV stores hold user-declared field values. `order_key` is system metadata, in the same category as `id` and `path` (which has its own table for locale variance).
- **Not a sidecar table (yet)** — a sidecar makes sense only if multiple ordering scopes emerge ("homepage order" vs. "sidebar order"). No real ask on file. The column-now / sidecar-later path is clean: a future `document_orderings(document_id, scope, order_key)` table layers on top with the existing column as the default scope.

**Backfill on adoption.** Existing rows in a newly-`orderable` collection start with `order_key = NULL`. The list-view sort is `ORDER BY order_key ASC NULLS LAST, created_at DESC`, so unkeyed rows fall to the bottom in a stable order until the editor drags them. No migration-time backfill needed — adoption is gradual and editor-driven.

**Drag-to-reorder semantics.** The admin list view uses `dnd-kit` with the vertical-list strategy. Each drop fires a single `reorderCollectionDocument` call carrying the dragged document and its new neighbours' IDs; the server resolves their `order_key`s in one query and writes a new key strictly between them via `generateKeyBetween(left, right)`. Drag is **disabled** when a search query is active, a status filter is active, or an explicit sort column other than `order_key` is selected — in any of those views the visible row order is not the canonical stored order, so "drop between A and B" would map to the wrong neighbour IDs. Reordering across pages is also disabled in this iteration — same-page drops only.

**Auth.** `reorderCollectionDocument` runs through `assertActorCanPerform(requestContext, collectionPath, 'update')`. No new ability slug — reorder is a metadata-level update of the document, so the existing `collections.<path>.update` ability is what's enforced. `beforeRead` row-scoping applies to the list-view fetch the same way it does for any read (the reorder UI consumes whichever rows the actor is allowed to see), so a multi-tenant collection that scopes by `tenantId` keeps drag-to-reorder per-tenant.

**Orthogonality with `hasMany`.** `hasMany` relation arrays carry their own order in the field value (array positions inside `store_relation`). The drag-handle on a `hasMany` picker reorders array entries inside a single document's content — that's a content edit and mints a new document version. `orderable: true` is the orthogonal axis: the canonical sort of the **collection's documents** independent of any single field's value. Both can be used together: a `sections` collection can be `orderable: true` (root order) while each section document carries a `children: relation(hasMany)` field (per-section order).

**Reading from `@byline/client`.** The SDK does **not** auto-default to `order_key` ordering — request it explicitly:

```ts
const sections = await client
  .collection('sections')
  .find({ sort: { orderKey: 'asc' } })   // or order_key: 'asc'
```

Both `orderKey` and `order_key` are accepted (`DOCUMENT_SORT_COLUMNS` in `packages/core/src/query/parse-where.ts`). The admin list view defaults to `order_key asc` automatically when the collection is `orderable: true`; SDK callers ask explicitly so reads from outside the admin UI stay predictable.

Two known gaps on the SDK path, both acceptable for the current implementation:

- **No `NULLS LAST` qualifier.** `parseSort` emits a single `ORDER BY order_key <dir>`. On Postgres, `ASC` puts `NULL` last by default — backfilled-but-undragged rows sink, which matches admin-view intent. `DESC` would float `NULL`s to the top.
- **Single sort key only.** `parseSort` reads only the first entry of the `sort` object, so a fallback tiebreaker (`{ orderKey: 'asc', createdAt: 'desc' }`) is silently dropped. Unkeyed rows therefore have no stable secondary order on the SDK path.

If either becomes load-bearing for an external consumer, the fix lives in `parseSort` / the adapter's `ORDER BY` emission — at which point matching the admin's `order_key ASC NULLS LAST, created_at DESC` is the obvious target.

**Intentionally NOT in scope:**

- **Bulk reorder API.** Single-row reorder covers the drag-drop UX. Bulk insert lands via `generateNKeysBetween` if a real need arrives.
- **Cross-page drops.** Same-page only at present.
- **Per-locale ordering.** `order_key` is one value per logical document. Defer to a sidecar table if anyone asks.
- **Reorder-versioning.** Order changes are not recorded in document history.

---

## Versioning

Byline lists **immutable versioning** as a differentiating pillar. The document half of that story has been in place since the beginning: every save writes a new `documentVersions` row keyed by UUIDv7, a `current_documents` view resolves "the latest" via `ROW_NUMBER() OVER PARTITION`, and status changes are the deliberate exception that mutates a row in place.

The collection half is *partially* in place. **Phase 1 — data model + fingerprinting — is shipped.** It records, on every document save, which schema version the document was written against. It does not yet read by that version.

| Phase | Goal | Status |
|---|---|---|
| 1 | Record `version` + `schema_hash` on `collections`; stamp `collection_version` on every `document_versions` row | **Shipped** |
| 2 | Historical config snapshots in a `collection_versions` table; FK from `document_versions` | Deferred |
| 3 | `getCollectionByVersion(collectionId, version)` lookup in core / client API | Deferred |
| 4 | In-memory forward-migration from any historical shape to the current shape | Deferred |
| 5 | Optional strict-CI mode (require manual `version` bumps on any hash change) | Deferred |

The larger goal is unchanged: a developer should be able to fetch any document version, resolve the collection schema *as it was* at that point in time, and migrate it forward in memory. Phase 1 is the recording layer that makes that possible later. Phases 2–5 build the migration machinery itself.

> **What you can rely on today.** Every document version carries an integer `collection_version` you can read and reason about, and every collection row carries a `schema_hash` that bumps when the data-affecting parts of the schema change. **What you cannot rely on yet:** materialising an old document against its original schema. The read path uses the live `CollectionDefinition` regardless of `collection_version`. See [Boundary](#boundary--what-does-not-read-by-version-yet) below.

### What Phase 1 ships

Two columns on `collections`, one on `document_versions`:

```sql
collections
  version       integer  NOT NULL DEFAULT 1
  schema_hash   varchar(64)             -- nullable in Phase 1; tightens in Phase 2

document_versions
  collection_version  integer  NOT NULL
```

Both `current_documents` and `current_published_documents` views project `collection_version` so it surfaces on every read. The columns landed in the baseline schema migration `0000_hard_madame_hydra.sql` (earlier migrations were consolidated into this one; they are not separate as-shipped). Every pre-existing row is implicitly v1.

`schema_hash` stays nullable until Phase 2 introduces the `collection_versions` history table — at that point the post-`ensureCollections()` invariant ("any row written by Byline has a hash") becomes a database constraint.

### Fingerprint

`schema_hash` is a SHA-256 over a canonicalised projection of the `CollectionDefinition`. The fingerprint defines what counts as a "schema change" for the purposes of bumping the version. It is deliberately narrow — only properties that affect the storable document shape participate.

**Included (a change bumps the version):**

- `path`
- `useAsTitle`, `useAsPath`
- `fields` (recursive). Per field: `name`, `type`, `optional`, `localized`. Compound types recurse into `fields` / `blocks`. Per type: `relation.targetCollection`, `relation.displayField`, `select.options.value`, `datetime.mode`, and `validation` for `text` / `textArea` / `richText` / `float` / `integer`.
- `workflow` — status `name`s and `defaultStatus`. Labels and verbs are stripped.
- Per-field `upload` — `mimeTypes`, `maxFileSize`, and `sizes[].{name, width, height, fit, format, quality}`.

**Excluded (changes do NOT bump):**

- `labels.singular`, `labels.plural`
- `hooks` (function values can't be JSON-stable anyway)
- `search`, `showStats` (admin UX)
- Field-level `label`, `helpText`, `placeholder` (admin UX)
- Workflow status `label`, `verb`
- `upload.storage` (provider implementation, not data shape)
- Select option `label`s

The stripping rules are enforced by **whitelist** — known keys are copied; unknown keys are dropped. So adding a new presentational field to `CollectionDefinition` will not silently churn versions. Stability is covered by 19 contract tests in `collection-fingerprint.test.node.ts`: key-order invariance, function exclusion, every "does NOT bump" rule, and every "DOES bump" rule.

**Why SHA-256, why Web Crypto.** SHA-256 over a 32-bit hash because this is the tamper-evidence record for the lifetime of the installation — collision resistance matters. 64 hex chars is cheap to store and compare. The hash is computed via `crypto.subtle.digest` (Web Crypto), not Node's `node:crypto`. An earlier iteration imported `node:crypto.createHash`; Vite's module-graph walker pulled the import into the client bundle (via `core.ts` → `collection-bootstrap.ts` → fingerprint) even though the client never calls `fingerprintCollection`. Externalising `node:crypto` would have thrown at runtime. The Web Crypto switch eliminated the issue without conditional platform code; the side-effect is that `fingerprintCollection` is `async`.

### Version-bump policy

`CollectionDefinition` carries an optional `version?: number`. Behaviour, in `ensureCollections` / `reconcileCollection`:

1. Compute the fingerprint of the in-memory definition.
2. **No row exists** → insert with `version = definition.version ?? 1` and the fingerprint.
3. **Row exists, hash matches** → no-op. Independent of any `definition.version` pin: the hash is the source of truth for "did the shape change?", and a no-op write would just add noise.
4. **Row exists, hash differs:**
   - `definition.version` pinned and `> stored.version` → use the pin.
   - `definition.version` pinned and `< stored.version` → throw. Pinning backwards is always a developer error (it silently desynchronises the version from document history).
   - `definition.version` pinned and `== stored.version` → use it. Effectively a "yes, I know the shape changed but don't bump" pin.
   - `definition.version` omitted → auto-bump to `stored.version + 1`.
5. **First-run-after-Phase-1 special case.** When `stored_hash` is NULL (existing row pre-dating this feature), don't auto-bump. Backfill the hash at whatever version the DB already holds. Without this, every collection would bump from v1 to v2 on the first boot after Phase 1 deployed, for no information reason.

The hybrid — auto-bump as default, explicit pin as escape hatch — was chosen over both alternatives:

- **"Explicit only" is easy to forget and produces silent drift.** A dev adds a field, forgets to bump, and `collection_version = 3` is now stamped on a row authored against a different shape than v3.
- **"Hash-only, no pin"** is the cleanest API but blocks two real workflows: aligning version numbers across environments (so staging catches up to prod), and reserving a round number for a planned major change.
- **The hybrid** keeps the common case zero-effort while allowing either escape. Even under a manual pin the hash is still recorded, so Phase 2 can detect "the config on disk no longer matches the version we have written down." That's why `schema_hash` exists as a separate column rather than being implied by `version`.

A future Phase-5 `strictCollectionVersions: true` flag could invert the default for CI, requiring explicit bumps when the hash changes. The plumbing is already in place — it's only a policy knob.

### Boundary — what does NOT read by version yet

Storage and the document lifecycle **write** `collection_version` but do not read by it. Every read still uses the current `CollectionDefinition` in memory.

A document from `collection_version = 2` loaded against a live v3 definition reconstructs against v3's field set. If v3 added a field, the field is absent on the reconstructed document (no row exists for it). If v3 removed a field, the orphan store rows from v2 are silently ignored by `restoreFieldSetData`. If v3 *renamed* a field, the v2 rows are orphaned the same way and the new name is absent — which is the failure mode that motivates the future migration phases.

This is the deliberate scope of Phase 1: record now so the migration story can land later **without a schema migration**. Until Phase 3+ ships, treat `collection_version` as recorded data without semantics in the read path.

### Startup reconciliation

`initBylineCore()` calls `ensureCollections()` once and caches the result on `BylineCore`. Reconciliation involves:

1. Fingerprinting every in-memory definition (sub-millisecond, no I/O).
2. Reading the stored row for each (one indexed `SELECT` on a ≤ 50-row table).
3. Comparing hashes.
4. Possibly an `UPDATE` (bump path) or `INSERT` (first boot).
5. Possibly throwing (backwards-pin error) **before the process accepts traffic**.

The loop is `Promise.all(...)` across all definitions, so wall-clock cost is one DB round-trip plus the fingerprint cost — not N round-trips. For a local Postgres that's ~5 ms total; for a managed DB across a VPC, ~10–50 ms. It's paid once per process.

**Why startup, not lazy.** A previous prototype used a lazy `ensureCollection(path)` that ran on every admin request. That worked when reconciliation was just "does the row exist? if no, insert." Phase 1 made the work *semantic* — decisions with consequences, including "should this throw and block the process?" — and where a semantic decision runs changes its failure surface.

| Concern | Startup | Lazy (per-request, cached) |
|---|---|---|
| When a `version` pin error surfaces | Server refuses to start (loud, ops-visible) | First request to the offending route fails (scattered, user-visible) |
| When version-bump logs appear | All at boot, easy to grep | Scattered across the day's request logs |
| When an unreachable DB blocks you | Boot | First request per collection |
| First-request latency | Normal | Adds 1–2 round-trips on cold collection paths |
| State predictability for ops | "Everything reconciled by the time the server is up" | "Each collection reconciles when someone first hits it" |
| Consistency under parallel cold-starts | Single synchronous phase, no races | Two simultaneous first-requests can both attempt a bump |

The last row matters under load. Lazy reconciliation inside a request handler has a lost-update window where two concurrent first-requests both compute the same hash, both see "no match," and both try to bump — yielding either a duplicate-key error or a double-bump. Startup reconciliation runs once, before any request.

**Where lazy (or a hybrid) would actually win** — three configurations would flip the trade, none of which apply today:

1. **Serverless / edge / short-lived processes.** Every cold start pays startup cost. For 20 collections at ~50 ms total, that's a meaningful slice of a 100 ms invocation budget. Byline's current target is a long-running Node process.
2. **Hundreds or thousands of collections in a multi-tenant installation.** At 500+ collections, even concurrent SELECTs get uncomfortable. Two better options at that scale: lazy DB reconciliation with synchronous in-memory fingerprinting at startup (catches authoring errors fail-fast without hitting the DB for unused schemas), or a "did anything change since last boot?" aggregate-hash check that reconciles individually only on a mismatch.
3. **Reconciliation starts doing expensive work.** If Phase 2's history-table writes get large enough that bumping 20 collections on a redeploy is painful, selective or deferred reconciliation would win.

The Phase-1 code is structured so that dropping in a lazy or hybrid strategy later is a localised change — `collectionRecords` stays the contract; only the population strategy moves.

**Fail-fast by default.** A concrete benefit worth pulling out: startup reconciliation means a backwards `version` pin, a duplicate collection path, or an adapter mis-configuration fails the process before it accepts traffic. Operators find out during deploy, not during the first affected request. For a CMS where the blast radius of a silent schema desync is "every document written during the window is mis-stamped," that's the correct trade even before considering performance.

---

## Future phases (versioning Phases 2–5)

The remaining versioning phases turn `collection_version` from recorded data into a load-bearing read primitive. Each phase produces a useful artefact on its own; they don't have to land together.

### Phase 2 — historical config snapshots

The smallest useful follow-up. Add a `collection_versions` history table:

```sql
collection_versions
  collection_id   uuid          fk → collections.id
  version         integer
  config          jsonb         -- the snapshot of CollectionDefinition at this version
  schema_hash     varchar(64)   NOT NULL
  created_at      timestamptz
  primary key (collection_id, version)
```

`reconcileCollection` writes one row per bump. `schema_hash` on `collections` tightens to `NOT NULL`. A composite FK from `document_versions.(collection_id, collection_version)` to `collection_versions.(collection_id, version)` becomes available; whether to add it is a Phase-2 decision (it pins the data integrity but breaks soft-delete-and-restore of versions).

### Phase 3 — fetch by version

Add `getCollectionByVersion(collectionId, version)` to `ICollectionQueries`, exposed through `BylineCore` and `@byline/client`. Returns the historical `CollectionDefinition` (deserialised from `collection_versions.config`). Cached per `(collectionId, version)` for the process lifetime — historical rows are immutable, so the cache has no invalidation problem.

This is the smallest read-side piece that unblocks anything interesting. With it, debugging tools and admin previews can render an old document against its original schema even before forward-migration logic exists.

### Phase 4 — in-memory forward-migration

Wire historical-definition lookup through `restoreFieldSetData` and the populate walk. The shape:

1. Read `(documentVersionId, collectionVersion)` from `document_versions`.
2. Fetch the historical `CollectionDefinition` for `(collectionId, collectionVersion)`.
3. Reconstruct the document against the historical schema.
4. Apply a chain of registered migration functions (`migrateV1ToV2`, `migrateV2ToV3`, …) to project the historical document onto the current schema in memory.
5. Hand the migrated document to the rest of the read pipeline.

The migration functions themselves are application code — Byline ships the framework that calls them, not the migrations. The contract is "given a document at version N, return a document at version N+1." Each migration is one function on `CollectionDefinition.migrations`, declared alongside the schema.

Open design question for Phase 4: whether migrations run on read (every read pays the migration cost; storage is never rewritten) or on next-write (the document is rewritten under the latest schema the next time it's edited). Today's leaning is read-time, with an opt-in "write-back" mode that materialises the migration into a new `documentVersion` after reading. Decided when Phase 4 lands.

### Phase 5 — strict-CI mode

A `strictCollectionVersions: true` flag on `BylineCore` config. When enabled, `reconcileCollection` throws if `definition.version` is omitted and the hash differs. Useful for CI pipelines that want every schema change to be an explicit, code-reviewable version bump. Off by default — auto-bump remains the dev-loop ergonomics choice.

---

## Known limitations today

- **`schema_hash` is nullable.** It tightens to `NOT NULL` when Phase 2 lands. The runtime invariant is that any row written post-`ensureCollections()` has a hash; only rows that exist *before* the first Phase-1 boot can legitimately carry `NULL`.
- **No composite FK from `document_versions` to a `(collection_id, version)` pair.** No table to anchor against until Phase 2.
- **Bootstrap is fail-fast, not fail-partial.** If one of N collections throws (e.g. a backwards pin), `Promise.all` rejects on the first failure and the server refuses to start. Other in-flight reconciliations may have already written to the DB. Intentional — a partially-reconciled startup is worse than no startup — but worth knowing.
- **`initBylineCore` is async.** The webapp uses top-level `await` in `byline/server.config.ts`, which TanStack Start / Vite support natively. Scripts that import the config for side effects (seeds, one-offs) inherit the wait via ESM module evaluation. A future non-Vite consumer would need to await explicitly.
- **Reads ignore `collection_version`.** A v2 document loaded against a live v3 schema reconstructs against v3, not v2. Renamed fields, removed fields, and type changes between versions are not handled until Phase 4.

---

## Code map

| Concern | Location |
|---|---|
| `CollectionDefinition` + `CollectionHooks` types | `packages/core/src/@types/collection-types.ts` |
| `CollectionAdminConfig` + layout primitives + `ColumnDefinition` | `packages/core/src/@types/admin-types.ts` |
| `defineCollection` / `defineAdmin` factories | `packages/core/src/@types/collection-types.ts`, `packages/core/src/@types/admin-types.ts` |
| `defineWorkflow` + workflow transition validator | `packages/core/src/workflow/workflow.ts` |
| Lifecycle hook dispatch | `packages/core/src/services/document-lifecycle.ts` |
| `beforeRead` predicate compilation | `packages/core/src/auth/apply-before-read.ts`, `packages/core/src/query/parse-where.ts` |
| Fingerprint | `packages/core/src/storage/collection-fingerprint.ts` |
| Fingerprint contract tests | `packages/core/src/storage/collection-fingerprint.test.node.ts` |
| Startup reconciliation | `packages/core/src/services/collection-bootstrap.ts` |
| `BylineCore` accessor | `packages/core/src/core.ts` (`getCollectionRecord(path)`) |
| Optional `version` pin | `packages/core/src/@types/collection-types.ts` (`CollectionDefinition.version`) |
| `collection_version` write | `packages/core/src/services/document-lifecycle.ts` (`DocumentLifecycleContext.collectionVersion`) |
| Postgres schema (columns + views) | `packages/db-postgres/src/database/schema/index.ts` |
| `collections.create/update` adapter | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| Baseline migration | `packages/db-postgres/src/database/migrations/0000_hard_madame_hydra.sql` |
| Default `ListView` (table-based) | `packages/host-tanstack-start/src/admin-shell/views/list-view/` |
| `RouterPager` (URL-driven pagination) | `packages/host-tanstack-start/src/admin-shell/chrome/router-pager.tsx` |
| Reference custom list view | `apps/webapp/byline/collections/media/components/media-list-view.tsx` |
| Reference comprehensive schema | `apps/webapp/byline/collections/news/schema.ts` |
| Reference comprehensive admin | `apps/webapp/byline/collections/news/admin.tsx` |
