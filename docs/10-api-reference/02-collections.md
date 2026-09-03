---
title: "Collections API"
path: "collections-reference"
summary: "Exact multi-document and singleton schema, admin presentation, block, workflow, lifecycle hook, layout, column, and preview configuration contracts."
---

# Collections API

Companions:
- [Collections](../04-collections/index.md) — recipes and explanation for modeling and presenting a collection.
- [Fields API](./03-fields.md) — every field definition accepted by `CollectionDefinition.fields`.
- [Configuration API](./01-configuration.md) — how collection, admin, block-admin, and server-hook registries enter the runtime.
- [Collection versioning](../04-collections/08-collection-versioning.md) — fingerprints, automatic version bumps, and explicit version pins.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — the `beforeRead` recipes include separating public and private singleton values.

This reference lists the complete application-facing document-resource and presentation contracts exported by `@byline/core`. Schemas are isomorphic; collection, singleton, and block admin configs are client-side presentation.

## `defineCollection(definition)`

```ts
function defineCollection<const C extends MultiCollectionDefinition>(
  definition: C & MultiCollectionDefinition
): C
```

Returns the definition unchanged while preserving literal paths, field names, select values, and block types for inference.

```ts
import { defineCollection } from '@byline/core'

export const Articles = defineCollection({
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  useAsPath: 'title',
  fields: [{ name: 'title', type: 'text', localized: true }],
})
```

## `CollectionDefinition`

```ts
type CollectionDefinition = MultiCollectionDefinition | SingletonDefinition
```

The `singleton` property discriminates the two branches. `defineCollection()` accepts only `MultiCollectionDefinition`; `defineSingleton()` accepts only the singleton branch.

### `MultiCollectionDefinition`

| Property | Required or default | Description |
|---|---|---|
| `singleton` | Omitted or `false` | Multi-document resource discriminant. |
| `path` | Required | Unique collection key used by storage, clients, abilities, routes, and admin registration. |
| `labels` | Required | `{ singular, plural }` display labels for collection UI. |
| `label` | `never` | Singleton-only singular label; rejected on a multi-document definition. |
| `fields` | Required | Ordered `Field[]` schema. `path`, `status`, and other reserved system attributes are not fields. |
| `workflow` | `DEFAULT_WORKFLOW` | Sequential workflow. Use `defineWorkflow()` or `SINGLE_STATUS_WORKFLOW`. |
| `hooks` | None | Isomorphic-safe `CollectionHooks` object or lazy loader. Put server-only hook modules in `ServerConfig.hooks.collections`. |
| `search` | None | Provider-search projection: `body`, `facets`, `filters`, and `zones`. Requires `ServerConfig.search`. |
| `listSearch` | Identity field | Top-level `text`, `textArea`, or `select` fields matched by the admin list's substring search. Independent of provider search. |
| `useAsTitle` | First suitable text field where a fallback exists | Field used as the document's single-line identity in headings, relations, projections, and logs. |
| `useAsPath` | UUID path | Top-level path-compatible field whose value initializes the sticky document path at create time. |
| `advertiseLocales` | `false` | Enables the document-grain available-locales control. Requires at least one localized field. |
| `buildDocumentPath` | Generic collection/path composition | Host function that builds a locale-agnostic root-relative public path for rich-text links and preview fallback. |
| `linksInEditor` | `false` | Includes this collection in the rich-text internal-link picker. Requires `useAsTitle`. |
| `showStats` | `false` | Shows per-status counts on the admin collection card. Adds one count read per enabled collection on landing. |
| `orderable` | `false` | Enables document-grain fractional ordering and drag-to-reorder. Mutually exclusive with `tree`. |
| `tree` | `false` | Enables a single-parent, per-parent ordered document hierarchy. Mutually exclusive with `orderable`. |
| `version` | Automatic | Explicit collection schema-version pin. It cannot be lower than the stored version. |

### `search`

```ts
search?: {
  body?: SearchFieldDecl[]
  facets?: SearchFieldDecl[]
  filters?: string[]
  zones?: string[]
}

type SearchFieldDecl = string | { field: string; boost?: number }
```

| Property | Description |
|---|---|
| `body` | Text-bearing fields included in full-text content. Rich-text entries require `ServerConfig.fields.richText.toText`. |
| `facets` | Relation fields whose targets contribute their counter and title values to the projection. |
| `filters` | Scalar fields projected for provider filtering or sorting. Built-in SQL providers currently advertise their supported capabilities separately. |
| `zones` | Named cross-collection search scopes. When omitted, an implicit zone matching the collection path supports collection search. |

[Search configuration](../06-search/01-configuration.md) documents valid field roles, weights, provider capabilities, and boot validation.

### `buildDocumentPath`

```ts
buildDocumentPath?: (
  doc: {
    id: string
    path: string
    status: string
    fields: Record<string, any>
  },
  ctx: { collectionPath: string }
) => string | null
```

Return a root-relative path beginning with `/`, or `null` when the collection cannot build one. Do not include an origin or locale prefix. The rich-text path composer falls back to `/${collectionPath}/${path}` when this function returns `null`; the admin preview resolver treats `null` as no meaningful preview URL.

```ts
buildDocumentPath: (doc) => (doc.path ? `/articles/${doc.path}` : null)
```

## `defineSingleton(definition)`

```ts
function defineSingleton<const S extends Omit<SingletonDefinition, 'singleton'>>(
  definition: S & Omit<SingletonDefinition, 'singleton'>
): S & { singleton: true }
```

The parameter supplies the singleton schema without its discriminator. The return value preserves literal path and field types and stamps `singleton: true` after the input spread.

```ts
import { defineSingleton } from '@byline/core'

export const SiteSettings = defineSingleton({
  path: 'site-settings',
  label: 'Site settings',
  fields: [{ name: 'siteName', label: 'Site name', type: 'text' }],
})
```

## `SingletonDefinition`

| Property | Required or default | Description |
|---|---|---|
| `singleton` | Required `true`; stamped by `defineSingleton()` | Resource-family discriminator. |
| `path` | Required | Unique slot key shared by configuration, generated registries, abilities, admin routing, client lookup, and storage mapping. |
| `label` | Required | Singular display label. |
| `fields` | Required | Ordered `Field[]` schema stored through the shared document runtime. |
| `workflow` | `DEFAULT_WORKFLOW` | Sequential workflow. `SINGLE_STATUS_WORKFLOW` makes every save immediately published and hides workflow controls. |
| `version` | Automatic | Explicit schema-version pin; it cannot be lower than the stored version. |
| `hooks` | None | `SingletonHooks` object or `SingletonHooksLoader`. Server-only modules belong in `ServerConfig.hooks.collections`. |
| `labels` | `never` | Multi-document plural labels are invalid. |
| `useAsTitle` | `never` | There is no list item that needs a derived title. |
| `useAsPath` | `never` | The backing document path is generated internal metadata, not a public identifier. |
| `orderable` | `never` | There are no sibling documents to order. |
| `tree` | `never` | A document tree requires several independently addressed documents. |
| `search` | `never` | Singleton search indexing is not shipped. |
| `listSearch` | `never` | There is no admin list to search. |
| `advertiseLocales` | `never` | The collection-level advertised-locale control is not part of the singleton surface. |
| `showStats` | `never` | There is no dashboard document-count query. |
| `linksInEditor` | `never` | Singletons are not rich-text link targets. |
| `buildDocumentPath` | `never` | A singleton does not expose a per-document public path. |

The explicit `?: never` members prevent the factory's generic parameter from absorbing collection-only excess properties. Runtime validation checks the same list for untyped JavaScript and rejects a collection and singleton that share one path.

Deferred relation-target, search-indexing, embedded-tree, and multi-tenant-instance surfaces are fenced in [Singletons — Not yet shipped](../04-collections/09-singletons.md#not-yet-shipped).

## `defineAdmin(schema, config)`

```ts
function defineAdmin<T = any>(
  schema: MultiCollectionDefinition,
  config: Omit<CollectionAdminConfig<T>, 'slug' | 'singleton'>
): CollectionAdminConfig<T>
```

Returns the admin config with `slug` set from `schema.path`.

```ts
import { defineAdmin } from '@byline/core'

import { Articles } from './schema.js'

export const ArticlesAdmin = defineAdmin(Articles, {
  columns: [
    { fieldName: 'title', label: 'Title', sortable: true },
    { fieldName: 'status', label: 'Status' },
  ],
  layout: { main: ['title', 'content'] },
})
```

## `CollectionAdminConfig`

| Property | Required or default | Description |
|---|---|---|
| `singleton` | `false`; stamped by `defineAdmin()` | Admin-resource discriminator. |
| `slug` | Required; set by `defineAdmin()` | Must equal the corresponding collection `path`. |
| `group` | None | Dashboard group this collection belongs to. Names an entry in `AdminConfig.collectionGroups` — a key, not a heading. Omit to place the collection in the leading ungrouped band. Boot-validated. |
| `columns` | Synthesized defaults | Columns for the collection's default list view. |
| `defaultSort` | `createdAt desc` | Initial list sort when the URL has no explicit order. Invalid on `orderable` collections. |
| `itemView` | `useAsTitle` plus `path` | Compact row/tile projection and presentation used by relation pickers and relation summaries. |
| `itemViewSort` | `defaultSort`, then `createdAt desc` | Sort used by item-view list surfaces. Invalid on `orderable` collections. |
| `defaultColumns` | None | Default field-name list used when no explicit column configuration is supplied. |
| `tabSets` | `[]` | Named tab bars referenced from `layout.main`. |
| `rows` | `[]` | Named horizontal field rows referenced from layouts, tabs, or groups. |
| `groups` | `[]` | Named labelled fieldsets referenced from layouts or tabs. |
| `layout` | All schema fields in `main` | Composes raw fields and named primitives into `main` and optional `sidebar`. |
| `fields` | `{}` | Per-field presentation overrides keyed by index-free schema path. Block field overrides belong in `BlockAdminConfig`. |
| `preview` | Collection path fallback | Custom preview URL function. It falls back through `buildDocumentPath`, then `/${collectionPath}/${doc.path}`. |
| `listView` | Default table | Component that completely replaces the default collection list view. |
| `listActions` | `[]` | Components rendered in the default list header. Ignored when `listView` replaces the default view. |

### `ListDefaultSort`

```ts
interface ListDefaultSort<T = any> {
  field: keyof T | 'createdAt' | 'updatedAt' | 'path'
  direction?: 'asc' | 'desc'
}
```

The direction defaults to `asc`. The field must be a top-level schema field or one of the listed document columns. Explicit URL sort parameters take precedence.

### `ColumnDefinition`

```ts
interface ColumnDefinition<T = any> {
  fieldName: keyof T
  label: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  className?: string
  formatter?:
    | ((value: any, record: T) => any)
    | { component: (props: { value: any; record: T }) => any }
}
```

| Property | Default | Description |
|---|---|---|
| `fieldName` | Required | Schema field or supported top-level document column. |
| `label` | Required | Column heading. |
| `sortable` | `false` | Enables the list's sort control when the storage/query surface supports the field. |
| `align` | Renderer default | Cell alignment. |
| `className` | None | CSS class applied by the table renderer. |
| `formatter` | Default field rendering | Plain function or component wrapper. Use the component form when the formatter needs React hooks or context. |

### Layout definitions

```ts
interface TabDefinition {
  name: string
  label: string
  fields: string[]
  condition?: (data: Record<string, any>) => boolean
}

interface TabSetDefinition {
  name: string
  tabs: TabDefinition[]
}

interface RowDefinition {
  name: string
  fields: string[]
}

interface GroupDefinition {
  name: string
  label?: string
  fields: string[]
}

interface LayoutDefinition {
  main: string[]
  sidebar?: string[]
}
```

| Primitive | Membership | Placement |
|---|---|---|
| Tab set | Tabs; each tab accepts schema fields, row names, and group names | `layout.main` only |
| Row | Schema field names only | Main, sidebar, tab, or group |
| Group | Schema fields and row names | Main, sidebar, or tab |
| Raw field | One schema field name | Main, sidebar, tab, row, or group according to the container rules |

Names must be unique within their registry. Admin validation rejects unknown references, duplicate placement, tab sets in the sidebar, nested groups, and other invalid combinations.

### `preview`

```ts
preview?: {
  url: (
    doc: { id: string; path: string; status: string; fields: T },
    ctx: { locale?: string }
  ) => string | null
}
```

Return a relative or absolute URL, or `null` to hide the preview action. Direct relation targets are populated to depth one using their item-view projection on the admin edit read.

### `listView` and `listActions`

```ts
interface ListViewComponentProps<TData = any> {
  data: TData
  workflowStatuses?: WorkflowStatus[]
}

interface ListActionComponentProps {
  collectionPath: string
}
```

A custom `listView` owns search, ordering, results, pagination, and header actions. `listActions` extend only the default list view and must perform their own permission gating.

## `defineSingletonAdmin(schema, config)`

```ts
function defineSingletonAdmin<T = any>(
  schema: SingletonDefinition,
  config: Omit<SingletonAdminConfig<T>, 'slug' | 'singleton'>
): SingletonAdminConfig<T>
```

The function returns the form config with `singleton: true` and `slug` set from `schema.path`.

```ts
import { defineSingletonAdmin } from '@byline/core'

export const SiteSettingsAdmin = defineSingletonAdmin(SiteSettings, {
  group: 'settings',
  layout: { main: ['siteName', 'siteDescription'] },
  preview: { url: () => '/' },
})
```

## `SingletonAdminConfig`

| Property | Required or default | Description |
|---|---|---|
| `singleton` | Required `true`; stamped by `defineSingletonAdmin()` | Admin-resource discriminator. |
| `slug` | Required; stamped by `defineSingletonAdmin()` | Must equal the corresponding singleton definition path. |
| `group` | None | Dashboard resource group name from `AdminConfig.collectionGroups`. |
| `tabSets` | `[]` | Named tab bars used by `layout`. |
| `rows` | `[]` | Named horizontal field rows used by `layout`, tabs, or groups. |
| `groups` | `[]` | Named labelled fieldsets used by `layout` or tabs. |
| `layout` | All schema fields in `main` | Shared form composition for the singleton editor. |
| `fields` | `{}` | Per-field presentation overrides keyed by index-free schema path. |
| `preview` | None | `{ url(doc, ctx) }` function receiving `{ id, status, fields }`; returns a relative or absolute URL, or `null` to hide preview. No internal document-path fallback is used. |
| `columns` | `never` | Collection list option. |
| `defaultSort` | `never` | Collection list option. |
| `defaultColumns` | `never` | Collection list option. |
| `itemView` | `never` | Collection item-list presentation option. |
| `itemViewSort` | `never` | Collection item-list sort option. |
| `listView` | `never` | Collection list replacement. |
| `listActions` | `never` | Collection list-header extension. |

The explicit `?: never` list prevents generic excess-property absorption. Startup validation applies the same kind and option checks to untyped configuration.

## Blocks

### `defineBlock(definition)`

```ts
interface Block {
  blockType: string
  fields: Field[]
  label?: string
  helpText?: string
  hooks?: FieldHooks
  validate?: (value: any, data: Record<string, any>) => string | undefined
}

function defineBlock<const B extends Block>(definition: B & Block): B
```

`blockType` is the stable discriminator stored on every block value. Keep block schema files isomorphic.

```ts
export const QuoteBlock = defineBlock({
  blockType: 'quote',
  label: 'Quote',
  fields: [
    { name: 'quoteText', type: 'richText' },
    { name: 'attribution', type: 'text', optional: true },
  ],
})
```

### `defineBlockAdmin(block, config)`

```ts
interface BlockAdminConfig {
  blockType: string
  fields?: Record<string, FieldAdminConfig>
}

function defineBlockAdmin<B extends Block>(
  block: B,
  config: { fields?: Record<string, FieldAdminConfig> }
): BlockAdminConfig
```

`defineBlockAdmin()` sets `blockType` from the block. Field keys are index-free schema paths relative to the block root, such as `quoteText` or `faq.answer`. A block admin config applies wherever that block type renders.

[Blocks](../04-collections/02-blocks.md) covers block storage, type generation, nested arrays, uploads, and editor overrides.

## Workflow

### `defineWorkflow(input?)`

```ts
interface DefineWorkflowInput {
  draft?: { label?: string; verb?: string }
  published?: { label?: string; verb?: string }
  archived?: { label?: string; verb?: string }
  customStatuses?: Array<{ name: string; label?: string; verb?: string }>
  defaultStatus?: string
}

function defineWorkflow(input?: DefineWorkflowInput): WorkflowConfig
```

The result always orders statuses as `draft`, every custom status, `published`, then `archived`. Custom statuses cannot reuse a required name. The default status is `draft` unless overridden.

```ts
workflow: defineWorkflow({
  customStatuses: [
    { name: 'needs_review', label: 'Needs review', verb: 'Request review' },
  ],
})
```

`DEFAULT_WORKFLOW` is the built-in draft/published/archived workflow. `SINGLE_STATUS_WORKFLOW` contains only `published`, publishes new documents immediately, and removes irrelevant workflow controls from the admin.

## Collection lifecycle hooks

Each hook accepts one function or an array executed sequentially. Use `defineHooks(hooks)` to type an object without changing it.

| Hook | Timing and contract |
|---|---|
| `beforeCreate` | Before persistence; may mutate the outgoing `data`. |
| `afterCreate` | After a create commits; suitable for side effects. |
| `beforeUpdate` | Before a new immutable version is written; may mutate `data` and receives the original data. |
| `afterUpdate` | After an update or restore commits. |
| `afterSystemFieldsChange` | After an actual path/available-locales change commits, or an explicit reconciliation retry. |
| `beforeStatusChange` | Before an in-place workflow transition. |
| `afterStatusChange` | After the workflow transition commits. |
| `beforeUnpublish` | Before published versions are archived by unpublish. |
| `afterUnpublish` | After unpublish commits. |
| `beforeDelete` | Before soft deletion. |
| `afterDelete` | After deletion commits. |
| `afterTreeChange` | After place, reorder, re-parent, removal, or delete-time tree reconciliation commits. |
| `beforeRead` | Before database work; returns a strict `QueryPredicate` AND-merged with the caller filter. Multiple hooks combine with AND. |
| `afterRead` | After populate for each materialized document; may mutate `doc.fields`. Nested reads must thread the supplied `readContext`. |

After hooks run outside the storage transaction. A post-commit failure cannot roll back the committed content or structural change. Callers must follow the lifecycle result's committed/failure contract rather than blindly retrying writes. `createDocument`, `updateDocument`, and `updateDocumentWithPatches` reject an `afterCreate` or `afterUpdate` failure with `ERR_DOCUMENT_HOOK_COMMITTED`; its details include the committed document/version IDs, the failed phase, and an allowlisted `ERR_STORAGE` or `ERR_UNHANDLED` side-effect code. This is a reconciliation signal, not permission to repeat the write.

Hooks attached directly to a schema must be safe in every graph that imports that schema. Register server-only hook loaders through `ServerConfig.hooks.collections`.

Upload hooks are separate field-scoped `beforeStore` and `afterStore` hooks. Their complete contract is in [File and media uploads](../04-collections/06-file-media-uploads.md#beforestore-and-afterstore-hooks).

## `SingletonHooks`

```ts
interface SingletonHooks {
  beforeSave?: SingletonHookSlot<BeforeSingletonSaveContext>
  afterSave?: SingletonHookSlot<AfterSingletonSaveContext>
  beforeStatusChange?: SingletonHookSlot<StatusChangeContext>
  afterStatusChange?: SingletonHookSlot<StatusChangeContext>
  beforeUnpublish?: SingletonHookSlot<BeforeUnpublishContext>
  afterUnpublish?: SingletonHookSlot<AfterUnpublishContext>
  beforeRead?: BeforeReadHookSlot
  afterRead?: SingletonHookSlot<AfterReadContext>
}
```

Each slot accepts one function or an ordered array. `beforeSave` runs inside the locked write transaction and may mutate `data`; `afterSave` runs after commit and cannot roll back a persisted version or initial mapping.

### Save contexts

```ts
interface BeforeSingletonSaveContext {
  data: Record<string, any>
  originalData: Record<string, any> | null
  singletonPath: string
  locale: string
  requestContext: RequestContext
  isInitialSave: boolean
  operation: SingletonSaveOperation
  documentId: string | null
}

interface AfterSingletonSaveContext {
  data: Record<string, any>
  originalData: Record<string, any> | null
  singletonPath: string
  locale: string
  requestContext: RequestContext
  isInitialSave: boolean
  operation: SingletonSaveOperation
  documentId: string
  documentVersionId: string
}
```

On the first save, `originalData` and `BeforeSingletonSaveContext.documentId` are `null`. `AfterSingletonSaveContext` always identifies the committed document and version.

### `SingletonSaveOperation`

```ts
type SingletonSaveOperation =
  | { type: 'save' }
  | { type: 'restore'; sourceVersionId: string }
  | {
      type: 'copyToLocale'
      sourceLocale: string
      targetLocale: string
      overwrite: boolean
    }
```

| Branch | `data` | `originalData` | `locale` |
|---|---|---|---|
| `save` | Submitted locale field tree after normalisation; mutable in `beforeSave`. | Current values in the same locale, or `null` on first materialisation. | Submitted locale, defaulting to the installation content locale. |
| `restore` | Complete historical **all-locale** field tree; localised fields remain locale maps. | Complete current all-locale field tree. | Literal `'all'`. |
| `copyToLocale` | Source values merged into the target payload according to `overwrite`. | Previous target-locale values, or `null` when the target locale had no values. | `targetLocale`. |

```ts
import type { SingletonHooks } from '@byline/core'

const hooks = {
  afterSave: ({ operation, documentVersionId }) => {
    if (operation.type === 'restore') console.info('restored', documentVersionId)
  },
} satisfies SingletonHooks
```

### Shared read and workflow contexts

| Hook | Context | Fields and return |
|---|---|---|
| `beforeRead` | `BeforeReadContext` | `{ collectionPath, requestContext, readContext }`; returns `QueryPredicate`, `false`, or `void`, synchronously or asynchronously. |
| `afterRead` | `AfterReadContext` | `{ doc, collectionPath, requestContext, readContext }`; may mutate raw `doc.fields` after populate. |
| `beforeStatusChange`, `afterStatusChange` | `StatusChangeContext` | `{ documentId, documentVersionId, collectionPath, path, previousStatus, nextStatus }`. The shared internal `path` is supplied for lifecycle side effects but is not a singleton client identity. |
| `beforeUnpublish` | `BeforeUnpublishContext` | `{ documentId, collectionPath, path }`. |
| `afterUnpublish` | `AfterUnpublishContext` | `{ documentId, collectionPath, path, archivedCount }`. |

```ts
const hooks = {
  beforeRead: ({ requestContext }) =>
    requestContext.actor == null ? false : undefined,
} satisfies SingletonHooks
```

Inline hook objects are family-validated at startup. `SingletonHooksLoader` is lazy, so a mismatched family fails on first lifecycle resolution; the imported object is cached, but its family is revalidated on every resolution.
