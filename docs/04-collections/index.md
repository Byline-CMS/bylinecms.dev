---
title: "Collections"
path: "collections"
summary: "Defining collections in Byline: defineCollection, the workflow system, lifecycle hooks (beforeCreate, beforeRead, afterUpdate…), and the admin presentation split."
---

# Collections

Companions:
- [Fields](./01-fields.md) — field-level schema and admin (slot components, helper factories, the per-field richtext editor swap).
- [Rich Text](./06-rich-text.md) — the Lexical adapter, its `EditorConfig`, and per-field overrides.
- [Authentication & Authorization](../06-auth-and-security/01-authn-authz.md) — auth + access-control subsystem, including six worked `beforeRead` row-scoping recipes (owner-only drafts, multi-tenant, soft-delete, …).
- [Document Storage](../03-architecture/01-document-storage.md) — *document* versioning (the sibling pillar — this doc covers *schema* versioning).
- [Document Paths](./04-document-paths.md) — how `useAsPath` lands in `byline_document_paths`.

## Overview

A collection is the unit of authoring in Byline. Like a Django model with its `ModelAdmin`, it lives in two places: a **schema** that declares what the collection *is* (`CollectionDefinition`, returned by `defineCollection`), and an **admin** that declares how it *renders* in the dashboard (`CollectionAdminConfig`, returned by `defineAdmin`). The two are linked by the schema's `path`. This doc is the working reference for both halves; the related [Collection Versioning](./07-collection-versioning.md) reference covers the schema-versioning layer that records which schema version each document was authored against.

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

### 4. Set item-view columns

When this collection is shown as a single item outside its own list — a relation picker row (e.g. `News.featureImage → Media`), a relation/`hasMany` tile, or a relation list-view cell — `itemView` columns give that row a tailored layout, typically narrower than the list view. Omit to fall back to `useAsTitle` + `path` on one line. (Formerly named `picker`, which still works as a deprecated alias.)

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
const itemViewColumns: ColumnDefinition[] = [
  { fieldName: 'image', label: 'Preview', formatter: { component: MediaThumbnail } },
  { fieldName: 'title', label: 'Title' },
  { fieldName: 'status', label: 'Status' },
]

defineAdmin(Media, { itemView: itemViewColumns })
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

What you cannot do *yet*: ask the server to render that document against the historical schema. Reads still use the live `CollectionDefinition` regardless of `collectionVersion`. See [the boundary](./07-collection-versioning.md#boundary--what-does-not-read-by-version-yet).

→ [Collection Versioning](./07-collection-versioning.md)

---

## Architecture

### The schema / admin split

A collection lives in two files:

- **Schema** (`collections/<name>/schema.ts`) — a `CollectionDefinition` returned by `defineCollection`. Pure data: `path`, `labels`, `fields[]`, `useAsTitle`, `useAsPath`, `workflow`, `hooks`, `search`, `showStats`, `linksInEditor`, `orderable`, `version`. **Must be tsx-loadable** — the server bootstrap in `apps/webapp/byline/server.config.ts` imports schemas directly so seeds and migrations can run outside Vite. No React. No CSS modules. No browser-only globals.

  The schema is **isomorphic** — the same module is *also* pulled into the **client** admin bundle (the admin shell reads field config from it). So the constraint runs both ways: just as a schema must avoid browser-only globals (so the server bootstrap can load it), it must avoid **server-only** modules (so the client can bundle it without dragging Node built-ins or backend code into the browser). Declarative field data and isomorphic-safe field hooks satisfy both directions. Register lifecycle/upload hooks that reach server-only code through the [server-only hook registry](#server-only-hook-registry), outside the schema graph.
- **Admin** (`collections/<name>/admin.tsx`) — a `CollectionAdminConfig` returned by `defineAdmin`. UI overrides: `columns`, `picker`, `tabSets` / `rows` / `groups` / `layout`, `preview.url`, `listView`, `fields{}` (per-field admin), `group`. React, CSS modules, and Vite-managed imports are all fine.

The split mirrors Django's `Model` / `ModelAdmin`. The same field names appear on both sides — the schema declares what the field *is*; the admin declares how it *renders*. The two halves are linked by the schema's `path` (`defineAdmin(schema, …)` sets `slug` from `schema.path` automatically). See [Fields](./01-fields.md) for the equivalent split at the field level.

### The `CollectionDefinition` surface

```ts
// packages/core/src/@types/collection-types.ts (excerpt)
export interface CollectionDefinition {
  labels: { singular: string; plural: string }
  path: string
  fields: Field[]
  workflow?: WorkflowConfig
  hooks?: CollectionHooks | CollectionHooksLoader
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
| `fields` | Schema-side field definitions. See [Fields](./01-fields.md) for the field-level model. |
| `useAsTitle` | The field whose value is the document's single-line label — form heading, relation widget summary, populate's default projection, log lines. Analogous to Django's `Model.__str__`. |
| `useAsPath` | The field whose value initialises a document's `path` row in `byline_document_paths`. Slugified once; sticky after creation. Collections without `useAsPath` receive a UUID path. See [Document Paths](./04-document-paths.md). |
| `workflow` | Sequential workflow config — see [Workflow](#workflow). Defaults to a standard `draft` → `published` → `archived` triple. |
| `hooks` | Lifecycle hooks (server-side). See [Lifecycle hooks](#lifecycle-hooks). |
| `search` | Role-based **provider indexing** config for site search (`body` / `facets` / `filters` / `zones`) — see [Search](../05-reading-and-delivery/07-search.md). Does not affect the admin list view's search box. |
| `listSearch` | Field names the admin list view's search box matches (`ILIKE` over `store_text`, so `text` / `textArea` / `select` fields only). Independent of `search`. Falls back to the identity field (`useAsTitle`, else the first text field) when omitted. |
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

The four major slot areas are: **columns** (list view + relation picker), **layout** (tabs / rows / groups composed into main/sidebar), **preview** (the preview URL builder), and **listView** (the custom-component escape hatch). Per-field admin lives in `fields{}` and is documented in [Fields](./01-fields.md).

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
import { useRouterState } from '@tanstack/react-router'
import type { ListViewComponentProps, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Link, useNavigate } from '@byline/host-tanstack-start/admin-shell/chrome/loose-router'
import { RouterPager } from '@byline/host-tanstack-start/admin-shell/chrome/router-pager'
import { getAdminRoutePath } from '@byline/host-tanstack-start/routes/admin-path'

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
      to: getAdminRoutePath('collections', '$collection'),
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
          {data.docs.map((doc) => (
            <Link
              key={doc.id}
              to={getAdminRoutePath('collections', '$collection', '$id')}
              params={{ collection: collectionPath, id: doc.id }}
            >
              {/* …card UI… */}
            </Link>
          ))}
        </div>
        <RouterPager page={data.meta.page} count={data.meta.totalPages} />
      </Container>
    </Section>
  )
}
```

**Key patterns:**

- **URL is the source of truth for search / order / page.** The view reads the current values from `useRouterState().location.search`, and changes write back via `useNavigate({ search })`. No local state for these — refreshes and shareable links work for free.
- **Reset `page` on any other change.** A new search or new ordering should land on page 1; carrying over `?page=4` to a new query yields confused empty pages.
- **Use the host wrappers for navigation.** Import `Link` / `useNavigate` from `admin-shell/chrome/loose-router` and build destinations with `getAdminRoutePath(...)`; never hard-code `/admin`, because the admin base path is configurable.
- **Pagination via `RouterPager`** from `@byline/host-tanstack-start/admin-shell/chrome/router-pager`. It writes the `page` search parameter using the same control as the default list view.
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
| Non-versioned path / advertised locales | `afterSystemFieldsChange` |
| Delete | `beforeDelete`, `afterDelete` |
| Status change | `beforeStatusChange`, `afterStatusChange` |
| Unpublish | `beforeUnpublish`, `afterUnpublish` |
| Document tree | `afterTreeChange` |
| Read | `beforeRead` (row-scoping predicate), `afterRead` (per-materialization mutation) |

**`beforeRead`** is the row-scoping hook. It returns a `QueryPredicate` that is ANDed with caller filters, but the two inputs compile separately: caller `where` uses the ordinary query parser, while the hook predicate uses the strict security compiler. The strict result compiles once per logical `ReadContext` + collection + effective read mode in private, authority-bound state; concurrent populate branches share that result. Unsupported fields/operators or malformed values throw rather than being weakened or dropped, and top-level `status` / `path` operators are emitted as document-column filters consistently across list, detail, populate, count, history, and tree reads. The deprecated caller-owned `ReadContext.beforeReadCache` is ignored, and attempting to reuse a logical read across authorities fails closed. Coverage is end-to-end — ordinary reads and counts, every immutable row in `history()` / `findByVersion()`, tree edges and hydration, search authorization, populated relations, and rich-text document/image targets all apply the target collection's ability and predicate. `auditLog()` is the deliberate exception described in [Auditability](../06-auth-and-security/02-auditability.md): it gates the document-grain log through the current document rather than applying a predicate to each audit row. See [Authentication & Authorization — Read-side scoping](../06-auth-and-security/01-authn-authz.md#read-side-scoping--the-beforeread-hook) for the full reference and worked recipes.

**`afterRead`** runs after populate on each fresh raw document materialization and receives mutable `ctx.doc`, the operation's immutable actor-aware `requestContext` (including effective `readMode`), and the shared `readContext`. The same object is processed only once, but a freshly materialized object may run again even for the same version. If a nested hook read reaches a version whose hook is still active, core fails closed with `ERR_READ_RECURSION` rather than returning a partially redacted object. Thread `ctx.readContext` into nested reads so budgets, predicate caching, and active-recursion guards remain effective.

`afterSystemFieldsChange` and `afterTreeChange` run **after** their audited transaction commits. The system-field context distinguishes requested intent from fields that actually changed and carries locked previous/current path and advertised-locale snapshots. Actual changes fire once; exact no-ops normally write, audit, and emit nothing. Callers may opt into no-op reconciliation to re-run failed side effects without another mutation or audit row (`SystemFieldsChangeContext.reconciliation` identifies that case; tree consumers must simply be idempotent). Hook arrays remain sequential and fail-fast.

When one hook has several independent post-commit effects, the simplest readable pattern is native `Promise.all`. Every promise in the array starts before the hook awaits settlement, so a cache failure does not prevent search reconciliation from being attempted. The trade-off is ordinary `Promise.all` error behavior: the hook reports the first rejection, not every simultaneous rejection.

```ts
afterUpdate: async ({ documentId, path }) => {
  // Cache invalidation and search reconciliation are independent post-commit
  // effects. Promise.all starts both, but reports only the first rejection.
  // For complete failure reporting, see "Advanced pattern: aggregate every
  // side-effect failure" in docs/04-collections/index.md.
  await Promise.all([
    invalidateDocument('news', path, { list: true }),
    getSystemBylineClient().collection('news').indexDocument(documentId),
  ])
}
```

#### Advanced pattern: aggregate every side-effect failure

Most hooks should prefer `Promise.all` for familiarity. If operations need both an attempt **and** complete failure reporting—for example, an operator must see that cache, CDN, and webhook delivery all failed—use a small application-owned `Promise.allSettled` helper:

```ts
/**
 * Run every lifecycle side effect, then report all failures together. Effects
 * are invoked synchronously in declaration order before awaiting settlement.
 */
export async function runSideEffects(
  label: string,
  ...effects: Array<() => void | Promise<void>>
): Promise<void> {
  const pending = effects.map((effect) => {
    try {
      return Promise.resolve(effect())
    } catch (error) {
      return Promise.reject(error)
    }
  })
  const failures = (await Promise.allSettled(pending))
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (failures.length === 0) return

  throw new AggregateError(failures, `${label}: ${failures.length} side effect(s) failed`)
}
```

This is an optional reliability pattern, not part of Byline core. Keep it in application server code and use it only where aggregated diagnostics justify the extra abstraction.

Server-side **upload** hooks (`beforeStore` / `afterStore`) live on the field's `upload` block — not on the collection — because they are field-scoped and field-aware. A collection with multiple image/file fields runs each field's pipeline independently.

#### Server-only hook registry

Collection schemas are [isomorphic](#the-schema--admin-split), so every static **or dynamic** import they contain is reachable from the browser build. A plain `() => import('./hooks.js')` is lazy loading, not a server boundary, and framework wrappers such as TanStack Start's `createServerOnlyFn` make the schema host-specific.

Register hooks that import server-only code through `ServerConfig.hooks` instead. The registry is imported only by `byline/server.config.ts`; client configuration and schemas never reach it.

```ts
// collections/server-hooks.ts — server-only and host-framework agnostic
import type { ServerHooksConfig } from '@byline/core'

export const serverHooks = {
  collections: {
    docs: () => import('./docs/hooks.js'),
  },
  uploads: {
    'media.image': () => import('./media/hooks.js'),
  },
} satisfies ServerHooksConfig
```

```ts
// server.config.ts
import { serverHooks } from './collections/server-hooks.js'

await initBylineCore({
  // …db, collections, adapters…
  hooks: serverHooks,
})
```

Core validates the complete registry before initialization mutates any definition, then attaches it only when boot commits successfully. Reinitialization may replace hooks previously owned by the registry (for HMR), but a registry entry may never overwrite hooks authored directly on a definition. Loaders are resolved and memoized by identity exactly as definition-attached loaders are.

Upload registry keys use `'<collectionPath>.<canonical schema path>'`. The schema path is the index-free walk of field names to the exact upload field. Array and group containers contribute their field name; a blocks field is followed by its block type:

- `documents.files.filesGroup.publicationFile` targets runtime instances such as `files[2].filesGroup.publicationFile`.
- `pages.content.hero.backgroundImage` targets `backgroundImage` inside the `hero` block type.

Collection paths, field names, and block types used in registry paths must be non-empty and dot-free. Upload-capable leaf names must be unique within a collection because the existing upload transport still selects fields by leaf name. Unknown collection/field/block segments and paths ending on non-upload fields fail at boot.

Definition-attached inline hooks and loaders remain valid for implementations whose entire import graph is isomorphic-safe. Field validation hooks such as `beforeValidate` are intentionally definition-attached because they may run in the browser. The reference scaffold also installs a production-build boundary that fails if `server-hooks.ts`, collection `hooks.ts`, or shared lifecycle modules enter a client chunk.

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
| Append-at-end on create / duplicate | `document-lifecycle/internals.ts` → `maybeAppendOrderKey` |
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

## Code map

| Concern | Location |
|---|---|
| `CollectionDefinition` + `CollectionHooks` types | `packages/core/src/@types/collection-types.ts` |
| `CollectionAdminConfig` + layout primitives + `ColumnDefinition` | `packages/core/src/@types/admin-types.ts` |
| `defineCollection` / `defineAdmin` factories | `packages/core/src/@types/collection-types.ts`, `packages/core/src/@types/admin-types.ts` |
| `defineWorkflow` + workflow transition validator | `packages/core/src/workflow/workflow.ts` |
| Lifecycle hook dispatch | `packages/core/src/services/document-lifecycle/` (per-operation modules) |
| `beforeRead` predicate compilation | `packages/core/src/auth/apply-before-read.ts`, `packages/core/src/query/parse-where.ts` |
| Fingerprint | `packages/core/src/storage/collection-fingerprint.ts` |
| Fingerprint contract tests | `packages/core/src/storage/collection-fingerprint.test.node.ts` |
| Startup reconciliation | `packages/core/src/services/collection-bootstrap.ts` |
| `BylineCore` accessor | `packages/core/src/core.ts` (`getCollectionRecord(path)`) |
| Optional `version` pin | `packages/core/src/@types/collection-types.ts` (`CollectionDefinition.version`) |
| `collection_version` write | `packages/core/src/services/document-lifecycle/context.ts` (`DocumentLifecycleContext.collectionVersion`) |
| Postgres schema (columns + views) | `packages/db-postgres/src/database/schema/index.ts` |
| `collections.create/update` adapter | `packages/db-postgres/src/modules/storage/storage-commands.ts` |
| Baseline migration | `packages/db-postgres/src/database/migrations/0000_hard_madame_hydra.sql` |
| Default `ListView` (table-based) | `packages/host-tanstack-start/src/admin-shell/collections/list.tsx` |
| `RouterPager` (URL-driven pagination) | `packages/host-tanstack-start/src/admin-shell/chrome/router-pager.tsx` |
| Reference custom list view | `apps/webapp/byline/collections/media/components/media-list-view.tsx` |
| Reference comprehensive schema | `apps/webapp/byline/collections/news/schema.ts` |
| Reference comprehensive admin | `apps/webapp/byline/collections/news/admin.tsx` |
