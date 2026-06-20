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

What you cannot do *yet*: ask the server to render that document against the historical schema. Reads still use the live `CollectionDefinition` regardless of `collectionVersion`. See [the boundary](./07-collection-versioning.md#boundary--what-does-not-read-by-version-yet).

→ [Collection Versioning](./07-collection-versioning.md)

---

## Architecture

### The schema / admin split

A collection lives in two files:

- **Schema** (`collections/<name>/schema.ts`) — a `CollectionDefinition` returned by `defineCollection`. Pure data: `path`, `labels`, `fields[]`, `useAsTitle`, `useAsPath`, `workflow`, `hooks`, `search`, `showStats`, `linksInEditor`, `orderable`, `version`. **Must be tsx-loadable** — the server bootstrap in `apps/webapp/byline/server.config.ts` imports schemas directly so seeds and migrations can run outside Vite. No React. No CSS modules. No browser-only globals.

  The schema is **isomorphic** — the same module is *also* pulled into the **client** admin bundle (the admin shell reads field config from it). So the constraint runs both ways: just as a schema must avoid browser-only globals (so the server bootstrap can load it), it must avoid **server-only** modules (so the client can bundle it without dragging Node built-ins or backend code into the browser). Declarative field data satisfies both directions for free. The **one exception is `hooks`** — their bodies run server-side only, but they are *referenced* from this client-bundled module, which makes them the single place server-only code can leak into the client. See [Hooks must not statically import server-only code](#hooks-must-not-statically-import-server-only-code).
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
| `fields` | Schema-side field definitions. See [Fields](./01-fields.md) for the field-level model. |
| `useAsTitle` | The field whose value is the document's single-line label — form heading, relation widget summary, populate's default projection, log lines. Analogous to Django's `Model.__str__`. |
| `useAsPath` | The field whose value initialises a document's `path` row in `byline_document_paths`. Slugified once; sticky after creation. Collections without `useAsPath` receive a UUID path. See [Document Paths](./04-document-paths.md). |
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

**`beforeRead`** is the row-scoping hook. It runs once per `findDocuments` call (and once per populate batch, per target collection), **before** any DB work, and returns a `QueryPredicate` that the query layer ANDs onto the caller's `where`. Use it for multi-tenant scoping, owner-only-drafts, soft-delete hide, etc. See [Authentication & Authorization — Read-side scoping](../06-auth-and-security/01-authn-authz.md#read-side-scoping--the-beforeread-hook) for the full reference, and the Quick Reference there for six worked recipes.

**`afterRead`** runs once per materialised document on every read path that flows through `@byline/client` or `populateDocuments`. Can mutate `ctx.doc.fields` in place; mutations propagate through the response. Fires after populate on the source document, so hooks see the fully populated tree. Hooks that perform their own reads should thread `ctx.readContext` through to preserve the visited set and read budget (A→B→A safety).

Server-side **upload** hooks (`beforeStore` / `afterStore`) live on the field's `upload` block — not on the collection — because they are field-scoped and field-aware. A collection with multiple image/file fields runs each field's pipeline independently.

#### Hooks must not statically import server-only code

Hooks are the one place a schema reaches server-only behaviour, and — because the schema is [isomorphic](#the-schema--admin-split) — they are also the one place server-only code can leak into the **client** bundle. The hook *bodies* never execute in the browser, but they are referenced from a client-bundled module, so the bundler keeps whatever they **statically import** at the top of the schema file. That pulls the entire transitive graph of those imports into the client.

The failure is asymmetric, which makes it easy to miss: **production** tree-shakes the unused hook bodies, so the leaked graph often disappears and the build looks clean; **dev** (Vite) does not tree-shake, so the module is evaluated in the browser, and a Node built-in anywhere in that graph throws at runtime — `Module "node:…" has been externalized for browser compatibility.`

**The rule:** a hook may *call* server-only code, but the schema file must never *statically import* it.

**Recommended fix — the loader form of `hooks`.** `hooks` accepts a thunk that dynamically imports the hooks module: `hooks: () => import('./docs.hooks.js')`. Because the schema reaches the hooks only through `import()`, the hooks module — and its entire transitive server-only graph — is *structurally absent* from the client bundle. No per-import discipline, no SSR guards in app code; the isolation is by construction.

```ts
// docs.schema.ts — isomorphic, client-safe by construction
export const Docs = defineCollection({
  // …declarative field config…
  hooks: () => import('./docs.hooks.js'),
})
```

```ts
// docs.hooks.ts — server-only; may statically import any server-only module freely
import { invalidateDocument } from '@/cache/with-cache'
import { defineHooks } from '@byline/core'

export default defineHooks({
  afterCreate: ({ collectionPath, path }) => invalidateDocument(collectionPath, path),
})
```

The loader is resolved once and memoized (keyed on the loader's identity), so the dynamic `import()` runs at most once per process regardless of how many documents flow through it. `defineHooks(...)` is optional — it mirrors `defineCollection` / `defineBlock` as a named factory; `export default { … } satisfies CollectionHooks` is equivalent. The hooks module's `default` export (or a bare returned object) is used. The inline form (`hooks: { … }`) stays valid for hooks whose bodies only touch isomorphic / declarative code.

**Field upload hooks (`field.upload.hooks`) take the same loader form.** `beforeStore` / `afterStore` are declared on an `upload`-capable field *inside the schema*, so they have identical client-bundle exposure — and are the most likely hooks to reach for server-only code (storage SDKs, `sharp`, AV scanners). Declare them the same way: `upload: { …, hooks: () => import('./media.hooks.js') }`, with the sibling module `export default { … } satisfies UploadHooks`. (Note: **field-level** validation hooks like `beforeValidate` are a different case — they can legitimately run client-side, so they are not server-only and are not deferred this way.)

**Alternative — keep hooks inline behind a client-safe, SSR-gated shim.** When you'd rather keep hook bodies in the schema file, defer the server-only call behind a shim the schema imports by name — the shim's only static import is `import type`, and the real module loads behind an SSR guard, so it never enters the schema's static graph:

```ts
// cache/invalidate-deferred.ts — client-safe; statically imports only types
import type { InvalidateDocumentOptions } from './with-cache'

export async function invalidateDocument(path: string, opts?: InvalidateDocumentOptions) {
  if (!import.meta.env.SSR) return            // dead-code-eliminated on the client
  await (await import('./with-cache')).invalidateDocument(path, opts)
}
```

```ts
// schema.ts — hook body unchanged; the import no longer reaches server-only code
import { invalidateDocument } from '@/cache/invalidate-deferred'
```

Either way, verify in **dev, not just `build`** — `build` tree-shaking masks the leak. If a server-only dependency appears in the client module graph, it is a schema-authoring bug, not a bundler-config problem.

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
| Default `ListView` (table-based) | `packages/host-tanstack-start/src/admin-shell/views/list-view/` |
| `RouterPager` (URL-driven pagination) | `packages/host-tanstack-start/src/admin-shell/chrome/router-pager.tsx` |
| Reference custom list view | `apps/webapp/byline/collections/media/components/media-list-view.tsx` |
| Reference comprehensive schema | `apps/webapp/byline/collections/news/schema.ts` |
| Reference comprehensive admin | `apps/webapp/byline/collections/news/admin.tsx` |
