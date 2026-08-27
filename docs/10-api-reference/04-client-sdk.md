---
title: "Client SDK API"
path: "client-sdk-reference"
summary: "Exact BylineClient construction, CollectionHandle and SingletonHandle methods, read and write options, result envelopes, search, history, audit, indexing, and document-tree contracts."
---

# Client SDK API

Companions:
- [Client SDK](../05-reading-and-delivery/01-client-sdk.md) — runnable recipes and explanation for reads, writes, filtering, population, preview, and request authority.
- [Configuration API](./01-configuration.md) — the request-bound public, viewer, admin, and system client getters.
- [Relationships](../04-collections/03-relationships.md) — populate syntax, depth, relation envelopes, and type overlays.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — abilities, `RequestContext`, row predicates, private singleton reads, and trusted escape hatches.

This reference lists the public `@byline/client` construction, collection and singleton handles, query, write, search, history, audit, indexing, and document-tree surface. All operations resolve a `RequestContext` and enforce the corresponding kind-aware ability unless the method is explicitly described as trusted maintenance infrastructure.

## `createBylineClient(config)`

```ts
function createBylineClient<
  TCollections extends CollectionRegistry = RegisteredCollections,
  TSingletons extends CollectionRegistry = RegisteredSingletons,
>(config: BylineClientConfig): BylineClient<TCollections, TSingletons>
```

Both registry generics default through generated declaration merging. `TCollections` maps multi-document paths to field shapes; `TSingletons` maps singleton paths to field shapes.

```ts
import { createSuperAdminContext } from '@byline/auth'
import { createBylineClient } from '@byline/client'
import { getServerConfig } from '@byline/core'

const client = createBylineClient({
  config: getServerConfig(),
  requestContext: createSuperAdminContext({ id: 'content-import' }),
})
```

### Generated `Register` merge

The generated application types declare both registries:

```ts
declare module '@byline/client' {
  interface Register {
    collections: CollectionFieldsByPath
    singletons: SingletonFieldsByPath
  }
}
```

`RegisteredCollections` and `RegisteredSingletons` conditionally read those members, then become the defaults for `BylineClient<TCollections, TSingletons>`. In a configured application, `client.collection('news')` and `client.singleton('site-settings')` therefore constrain paths and infer generated field shapes without explicit generics. An application with an empty singleton registry gets `keyof SingletonFieldsByPath = never`, so an arbitrary singleton path does not type-check.

## `BylineClientConfig`

| Property | Requirement or default | Description |
|---|---|---|
| `config` | Optional shorthand | Resolved server config supplying database, collections, storage, search, slugifier, rich-text adapters, and locale defaults. |
| `db` | Required without `config` | Database adapter. An explicit value overrides `config.db`. |
| `collections` | Required without `config` | Collection tuple. An explicit value overrides `config.collections`. |
| `storage` | `config.storage` | Installation storage provider forwarded into document lifecycle contexts and hooks. Document deletion retains uploaded objects. |
| `search` | `config.search` | Search provider used by collection and zone search. Calls fail clearly when no provider exists. |
| `richTextToText` | `config.fields.richText.toText` | Plain-text extractor used while constructing search projections. |
| `contentLocales` | Configured content locales, then `[defaultLocale]` | Locales walked by indexing operations. |
| `logger` | Registered core logger, then silent logger | Structured lifecycle logger. |
| `defaultLocale` | Configured content default, then `en` | Implicit locale for reads, writes, paths, and indexing. |
| `slugifier` | `config.slugifier`, then `slugify` | Document-path slugifier used by lifecycle writes. |
| `richTextPopulate` | `config.fields.richText.populate` | Read-time rich-text relation refresher. |
| `requestContext` | Required in practice | Static `RequestContext` or per-operation factory. Omission makes operations fail with `ERR_UNAUTHENTICATED`. |

An explicit disaggregated property wins over the same value from `config`. This supports tests and migrations that substitute one dependency without registering a complete core.

## `BylineClient` properties

| Property | Type | Description |
|---|---|---|
| `db` | `IDbAdapter` | Resolved database adapter. |
| `collections` | `readonly CollectionDefinition[]` | Resolved schema tuple. |
| `storage` | `IStorageProvider \| undefined` | Resolved storage provider. |
| `logger` | `BylineLogger` | Resolved lifecycle logger. |
| `defaultLocale` | `string` | Default content locale. |
| `slugifier` | `SlugifierFn \| undefined` | Custom path slugifier, or undefined when lifecycle code should use the built-in default. |
| `richTextPopulate` | `RichTextPopulateFn \| undefined` | Resolved read-time rich-text adapter. |
| `searchProvider` | `SearchProvider \| undefined` | Resolved search driver. The query method is named `search()`. |
| `richTextToText` | `RichTextToTextFn \| undefined` | Resolved search-index text extractor. |
| `contentLocales` | `string[]` | Locales walked by indexing operations. |

### `requestContext`

```ts
requestContext?:
  | RequestContext
  | (() => RequestContext | Promise<RequestContext>)
```

Use a static context for a script that authenticates once. Use a factory for request-bound code. A factory must return the same logical authority, including `requestId`, throughout one request; host adapters use request memoization to satisfy that contract.

## `BylineClient` methods

### `collection(path)`

```ts
client.collection<TPath extends keyof TCollections & string>(
  path: TPath
): CollectionHandle<TCollections[TPath]>
```

Returns a collection-scoped handle or throws `ERR_NOT_FOUND` when the configured tuple has no matching path.

### `singleton(path)`

```ts
client.singleton<TPath extends keyof TSingletons & string>(
  path: TPath
): SingletonHandle<TSingletons[TPath]>
```

Returns the document-ID-free singleton handle. It throws `ERR_NOT_FOUND` for an unknown path and `ERR_VALIDATION` when the path belongs to a multi-document collection.

```ts
const settings = client.singleton('site-settings')
```

### `search(options)`

```ts
client.search(options: ZoneSearchOptions): Promise<ClientSearchResults>
```

Runs cross-collection ranked search over one configured zone. Collections the actor cannot read are excluded; `beforeRead` applies per collection.

### `resolveRequestContext()`

```ts
client.resolveRequestContext(): Promise<RequestContext>
```

Resolves the configured static context or factory. Framework and application integrations rarely need to call it directly.

### Collection record lookups

```ts
client.resolveCollectionRecord(path: string): Promise<{ id: string; version: number }>
client.resolveCollectionId(path: string): Promise<string>
```

Both use a per-client cache. Lifecycle writes use the version to stamp `collection_version`; ordinary reads usually need only the ID.

## `SingletonHandle`

`SingletonHandle<TFields>` addresses one registered singleton slot without a caller-supplied document id.

| Method | Returns | Before first save |
|---|---|---|
| `get(options?)` | `Promise<SingletonDocument<TFields> \| null>` | `null` |
| `update(data, options?)` | `Promise<SingletonSaveResult>` | Creates the backing document, first version, and slot mapping |
| `changeStatus(nextStatus)` | `Promise<ChangeStatusResult>` | `ERR_NOT_FOUND` |
| `unpublish()` | `Promise<UnpublishResult>` | `ERR_NOT_FOUND` |
| `schedulePublish(options)` | `Promise<DocumentPublishScheduleInfo>` | `ERR_NOT_FOUND` |
| `confirmScheduledPublish(options)` | `Promise<DocumentPublishScheduleInfo>` | `ERR_NOT_FOUND` |
| `cancelScheduledPublish()` | `Promise<DocumentPublishScheduleInfo \| null>` | `ERR_NOT_FOUND` |
| `getScheduledPublish()` | `Promise<DocumentPublishScheduleInfo \| null>` | `null` |
| `history(options?)` | `Promise<FindResult<F>>` | Empty page with caller defaults |
| `findByVersion(versionId, options?)` | `Promise<ClientDocument<F> \| null>` | `null` |
| `restoreVersion(sourceVersionId)` | `Promise<SingletonSaveResult>` | `ERR_NOT_FOUND` |
| `copyToLocale(args)` | `Promise<SingletonSaveResult>` | `ERR_NOT_FOUND` |

### `get(options?)`

```ts
handle.get(options?: GetSingletonOptions<TFields>):
  Promise<SingletonDocument<TFields> | null>
```

`GetSingletonOptions` is `FindByIdOptions`: `select`, `locale`, `populate`, `depth`, `status`, `onMissingLocale`, `lenient`, and the trusted read controls. `status` defaults to `published`; the other defaults match `findById()`. `SingletonDocument` omits the backing document's internal `path`.

```ts
const settings = await client.singleton('site-settings').get({
  select: ['siteName'],
  locale: 'en',
})
```

### `update(data, options?)`

```ts
interface UpdateSingletonOptions {
  locale?: string
  expectedVersionId?: string
}

handle.update(
  data: TFields,
  options?: UpdateSingletonOptions
): Promise<SingletonSaveResult>
```

`locale` defaults to the client content locale. The first save must use that default locale. The result is `{ documentId, documentVersionId }`.

When `expectedVersionId` is present and differs from the current mapped version, the method throws `ERR_CONFLICT` with the expected and current version ids. Omit it for the first save; pass the `versionId` read by an interactive editor for subsequent saves.

```ts
const handle = client.singleton('site-settings')
const current = await handle.get({ status: 'any' })
if (current == null) throw new Error('Site settings have not been saved')
await handle.update({ ...current.fields, siteName: 'Example site' }, {
  expectedVersionId: current.versionId,
})
```

### Workflow methods

```ts
handle.changeStatus(nextStatus: string): Promise<ChangeStatusResult>
handle.unpublish(): Promise<UnpublishResult>
```

`changeStatus()` requires `singletons.<path>.changeStatus`; a transition to `published` additionally requires `.publish`. It returns `{ previousStatus, newStatus }`. `unpublish()` requires `.changeStatus` and returns `{ archivedCount }`. Both use the definition's workflow and reject an unmaterialised slot with `ERR_NOT_FOUND`.

```ts
await client.singleton('announcement').changeStatus('published')
```

### Scheduled publication methods

```ts
handle.schedulePublish(
  options: SchedulePublishOptions
): Promise<DocumentPublishScheduleInfo>

handle.confirmScheduledPublish(
  options: ConfirmScheduledPublishOptions
): Promise<DocumentPublishScheduleInfo>

handle.cancelScheduledPublish(): Promise<DocumentPublishScheduleInfo | null>
handle.getScheduledPublish(): Promise<DocumentPublishScheduleInfo | null>
```

`SchedulePublishOptions` is `{ publishAt: string, expectedVersionId: string }`; `ConfirmScheduledPublishOptions` is `{ expectedVersionId: string }`. All four methods require `.changeStatus` and `.publish`. `publishAt` must be a future ISO instant with an explicit offset or `Z`.

`cancelScheduledPublish()` returns `null` when no row remains after its transaction wins the lock. `getScheduledPublish()` returns `null` when the slot or schedule is absent. The returned `DocumentPublishScheduleInfo` omits internal execution fencing fields.

```ts
const handle = client.singleton('announcement')
const current = await handle.get({ status: 'any' })
if (current == null) throw new Error('Announcement has not been saved')
await handle.schedulePublish({
  publishAt: '2027-01-15T09:00:00Z', expectedVersionId: current.versionId,
})
```

### History methods

```ts
handle.history<F = TFields>(options?: HistoryOptions): Promise<FindResult<F>>

handle.findByVersion<F = TFields>(
  versionId: string,
  options?: FindByVersionOptions<F>
): Promise<ClientDocument<F> | null>
```

`HistoryOptions` is `{ locale?, page?, pageSize?, order?, desc? }` plus trusted read controls. An empty slot returns `{ docs: [], meta: { total: 0, page, pageSize, totalPages: 0 } }`, using page `1` and page size `20` unless supplied.

`FindByVersionOptions` is `{ select?, locale? }` plus trusted read controls. The requested version must belong to the currently mapped document; an unknown, hidden, orphaned, or unmaterialised version returns `null`. These editorial methods authorize reads in `any` mode. Their shared historical `ClientDocument` envelopes may contain the backing document's internal path metadata; it is not a singleton URL or identity.

```ts
const versions = await client.singleton('site-settings').history({ pageSize: 10 })
const versionId = versions.docs[0]?.versionId
const version = versionId
  ? await client.singleton('site-settings').findByVersion(versionId)
  : null
```

### Restore and locale copy

```ts
handle.restoreVersion(sourceVersionId: string): Promise<SingletonSaveResult>

handle.copyToLocale(args: {
  sourceLocale: string
  targetLocale: string
  overwrite?: boolean
}): Promise<SingletonSaveResult>
```

Both methods require `.update` and throw `ERR_NOT_FOUND` before materialisation. `restoreVersion()` requires a historical version owned by the currently mapped document, reconstructs its complete all-locale field tree, and writes a new version at the workflow default status. `copyToLocale()` requires different source and target locales; `overwrite` defaults to `false`.

```ts
await client.singleton('site-settings').copyToLocale({
  sourceLocale: 'en',
  targetLocale: 'fr',
})
```

## `CollectionHandle` method index

| Method | Returns | Purpose |
|---|---|---|
| `find(options?)` | `Promise<FindResult<F>>` | Paginated current-document query. |
| `findOne(options?)` | `Promise<ClientDocument<F> \| null>` | First matching current document. |
| `findById(id, options?)` | `Promise<ClientDocument<F> \| null>` | Current document by logical ID. |
| `findByPath(path, options?)` | `Promise<ClientDocument<F> \| null>` | Current document by locale-resolved path. |
| `search(options)` | `Promise<ClientSearchResults>` | Ranked search scoped to this collection. |
| `create(data, options?)` | `Promise<CreateDocumentResult>` | Creates a logical document and first immutable version. |
| `update(id, data, options?)` | `Promise<UpdateDocumentResult>` | Full-document replacement that creates a new immutable version. |
| `changeStatus(id, nextStatus)` | `Promise<ChangeStatusResult>` | Applies one valid workflow transition. |
| `schedulePublish(id, options)` | `Promise<DocumentPublishScheduleInfo>` | Arms or reschedules publication of one reviewed current version. |
| `confirmScheduledPublish(id, options)` | `Promise<DocumentPublishScheduleInfo>` | Re-authorizes a suspended schedule against the reviewed current version. |
| `cancelScheduledPublish(id)` | `Promise<DocumentPublishScheduleInfo \| null>` | Cancels a pending schedule and reports the actual transaction winner. |
| `getScheduledPublish(id)` | `Promise<DocumentPublishScheduleInfo \| null>` | Reads the document's active or suspended schedule. |
| `unpublish(id)` | `Promise<UnpublishResult>` | Archives the currently published version or versions. |
| `restoreVersion(id, sourceVersionId)` | `Promise<RestoreVersionResult>` | Copies historical content into a new current version. |
| `delete(id)` | `Promise<DeleteDocumentResult>` | Soft-deletes the document and reconciles associated structural state. |
| `count(options?)` | `Promise<number>` | Editorial current-version count, optionally for one exact status. |
| `countByStatus()` | `Promise<Array<{ status, count }>>` | Editorial counts grouped by workflow status. |
| `history(id, options?)` | `Promise<FindResult<F>>` | Paginated immutable version history. |
| `findByVersion(versionId, options?)` | `Promise<ClientDocument<F> \| null>` | One exact historical version, constrained to this collection. |
| `auditLog(id, options?)` | `Promise<AuditLogPage>` | Paginated document-grain non-versioned audit entries. |
| `indexDocument(id)` | `Promise<void>` | Reconciles one document's published locale projections into search. |
| `removeFromIndex(id)` | `Promise<void>` | Removes one document's projections from search. |
| `reindex()` | `Promise<ReindexResult>` | Clears and rebuilds this collection's search index. |
| `placeTreeNode(id, options)` | `Promise<{ orderKey: string }>` | Places, reorders, or reparents one node in a tree collection. |
| `removeFromTree(id, options?)` | `Promise<void>` | Makes a tree document unplaced without deleting it. |
| `getSubtree(options?)` | `Promise<TreeNode<F>[]>` | Reads a nested tree or subtree. |
| `getAncestors(id, options?)` | `Promise<ClientDocument<F>[]>` | Reads root-first breadcrumbs excluding the queried node. |
| `getTreeParent(id, options?)` | `Promise<TreeParentResult>` | Reads placed/root/child state with hidden-parent redaction. |

## Current-document reads

### `find(options?)`

```ts
handle.find<F = RegisteredFields>(options?: FindOptions<F>): Promise<FindResult<F>>
```

```ts
interface FindOptions<F> {
  where?: WhereClause
  select?: (keyof F & string)[] | string[]
  sort?: SortSpec
  locale?: string
  page?: number
  pageSize?: number
  populate?: PopulateSpec
  depth?: number
  status?: 'published' | 'any'
  onMissingLocale?: 'fallback' | 'empty' | 'omit'
}
```

| Option | Default | Description |
|---|---|---|
| `where` | None | Caller predicate over fields and reserved document keys. |
| `select` | All fields | Field projection. The option is named `select`; returned content remains under `doc.fields`. |
| `sort` | Adapter default | String, array, or object sort specification. |
| `locale` | Client default | Requested content locale. |
| `page` | `1` | One-based page. |
| `pageSize` | `20` | Documents per page. |
| `populate` | None | Relation population specification. |
| `depth` | `1` when populate is set, otherwise `0` | Maximum relation traversal depth, clamped by the internal read context. |
| `status` | `published` | Source view. `where.status` remains a separate exact-status filter. |
| `onMissingLocale` | `fallback` | Missing-localized-content behavior. |

Every read option type also carries trusted `_bypassBeforeRead?: true`; hook re-entry shapes carry `_readContext`. Public application code must not use either escape hatch.

### `findOne(options?)`

```ts
handle.findOne<F>(options?: {
  where?: WhereClause
  select?: string[]
  locale?: string
  populate?: PopulateSpec
  depth?: number
  status?: 'published' | 'any'
  onMissingLocale?: 'fallback' | 'empty' | 'omit'
}): Promise<ClientDocument<F> | null>
```

Uses the same read pipeline as `find()` and returns the first match.

### `findById(id, options?)`

```ts
handle.findById<F>(documentId: string, options?: {
  select?: string[]
  locale?: string
  populate?: PopulateSpec
  depth?: number
  status?: 'published' | 'any'
  onMissingLocale?: 'fallback' | 'empty' | 'omit'
  lenient?: boolean
}): Promise<ClientDocument<F> | null>
```

`lenient: true` skips rows that cannot be reconstructed against the current schema and returns `_restoreWarnings`. It is intended for the admin recovery/edit path; public reads should fail rather than serve partial data.

### `findByPath(path, options?)`

```ts
handle.findByPath<F>(path: string, options?: {
  select?: string[]
  locale?: string
  populate?: PopulateSpec
  depth?: number
  status?: 'published' | 'any'
  onMissingLocale?: 'fallback' | 'empty' | 'omit'
}): Promise<ClientDocument<F> | null>
```

Resolves the path with the request locale and document source-locale fallback rules. Path conflicts are prevented by the storage uniqueness contract.

## Filtering and sorting

`WhereClause` is the client alias for the canonical `QueryPredicate` from `@byline/core`.

```ts
where: {
  $and: [
    { status: 'published' },
    { views: { $gte: 100 } },
    { category: { path: 'news' } },
  ],
}
```

Reserved keys such as `status` and `path` address document metadata. Relation objects without `$` operators become nested predicates against the target collection. [Client SDK](../05-reading-and-delivery/01-client-sdk.md#filtering) documents the complete operator behavior and strict security-predicate boundary.

```ts
sort: 'publishedOn'
sort: '-publishedOn'
sort: ['-publishedOn', 'title']
sort: { publishedOn: 'desc' }
```

## Missing-locale policy

| Value | Behavior |
|---|---|
| `fallback` | Returns the document and resolves localized values through the locale fallback chain. |
| `empty` | Returns the document with missing requested-locale values empty. Used by authoring flows. |
| `omit` | Excludes documents unavailable in the requested locale; detail reads return `null`. |

Relation population always uses fallback behavior so a populated graph does not develop locale holes.

## `ClientDocument`

```ts
interface ClientDocument<F> {
  id: string
  versionId: string
  path: string
  status: string
  sourceLocale?: string
  createdAt: Date
  updatedAt: Date
  createdBy?: string
  eventType?: string
  fields: F
  _restoreWarnings?: string[]
  availableLocales?: string[]
  _availableVersionLocales?: string[]
  _localeAgnostic?: boolean
}
```

| Property | Description |
|---|---|
| `id` | Stable logical document ID. |
| `versionId` | Specific immutable version returned by this read. |
| `path` | Locale-resolved document path. |
| `status` | Workflow status of the returned version. |
| `sourceLocale` | Stable content locale assigned when the document was created. |
| `createdAt`, `updatedAt` | Version timestamps. |
| `createdBy` | Actor ID that created this immutable version, when recorded. |
| `eventType` | Lifecycle action that produced the version. |
| `fields` | Collection field data. |
| `_restoreWarnings` | Lenient reconstruction warnings. |
| `availableLocales` | Editor-advertised locale set stored at document grain. |
| `_availableVersionLocales` | Derived locales structurally available on this returned version. |
| `_localeAgnostic` | Indicates that the document has no localized content. |

`find()` returns `{ docs, meta }`, where `meta` contains `total`, `page`, `pageSize`, and `totalPages`.

## Population type helpers

```ts
type WithPopulated<F, K extends keyof F, Target> = /* one relation */
type WithPopulatedMany<F, K extends keyof F, Target> = /* hasMany relation */
```

These helpers overlay the operation-specific populated shape on canonical generated types. They do not trigger population at runtime.

```ts
type PopulatedArticle = WithPopulated<ArticleFields, 'category', CategoryFields>

const article = await client.collection('articles').findById<PopulatedArticle>(id, {
  populate: { category: '*' },
})
```

## Writes

### `create(data, options?)`

```ts
handle.create(data: Record<string, any>, options?: {
  locale?: string
  status?: string
  path?: string
  availableLocales?: string[]
}): Promise<CreateDocumentResult>
```

| Option | Default | Description |
|---|---|---|
| `locale` | Client default | Locale of the submitted field values and new document source locale. |
| `status` | Collection workflow default | Initial workflow status. |
| `path` | Derived from `useAsPath`, then UUID | Explicit initial document path. |
| `availableLocales` | Empty set | Initial editor-advertised content locales. |

### `update(id, data, options?)`

```ts
handle.update(documentId: string, data: Record<string, any>, options?: {
  locale?: string
  path?: string
  availableLocales?: string[]
}): Promise<UpdateDocumentResult>
```

Updates use whole-document replacement semantics and mint a new immutable version. Omitting `path` or `availableLocales` preserves the existing document-grain value; an explicit empty locale array clears the advertised set.

### Workflow and restoration

```ts
handle.changeStatus(documentId: string, nextStatus: string): Promise<ChangeStatusResult>
handle.unpublish(documentId: string): Promise<UnpublishResult>
handle.restoreVersion(
  documentId: string,
  sourceVersionId: string
): Promise<RestoreVersionResult>
```

`changeStatus()` accepts a valid adjacent transition or reset to the first workflow status. Publishing archives other published versions of the same document. `restoreVersion()` copies all-locale historical content into a new version at the definition's configured default status. That is `draft` for `DEFAULT_WORKFLOW` and `published` for `SINGLE_STATUS_WORKFLOW`.

### Scheduled publication

```ts
interface SchedulePublishOptions {
  publishAt: string
  expectedVersionId: string
}

interface ConfirmScheduledPublishOptions {
  expectedVersionId: string
}

handle.schedulePublish(
  documentId: string,
  options: SchedulePublishOptions
): Promise<DocumentPublishScheduleInfo>

handle.confirmScheduledPublish(
  documentId: string,
  options: ConfirmScheduledPublishOptions
): Promise<DocumentPublishScheduleInfo>

handle.cancelScheduledPublish(
  documentId: string
): Promise<DocumentPublishScheduleInfo | null>

handle.getScheduledPublish(
  documentId: string
): Promise<DocumentPublishScheduleInfo | null>
```

All four methods require both the collection's `changeStatus` and `publish` abilities. `publishAt` must be an ISO instant with an explicit offset or `Z` and must be later than database time. `expectedVersionId` binds the authorization to the exact current version the caller reviewed. A later content edit preserves the schedule but moves it to `needs_reconfirm`; confirmation targets the new current version while preserving the original publication instant. Ordinary status changes, unpublishing, and deletion cancel the pending intent through their normal lifecycle transactions.

`cancelScheduledPublish()` returns `null` when no schedule remained after its transaction acquired the row lock. Callers should report that result as a lost cancellation race, not as a successful cancellation. `getScheduledPublish()` returns either `armed` or `needs_reconfirm` state. The `DocumentPublishScheduleInfo` result includes editorial timing, authorization, suspension, attempt, and bounded error metadata; it deliberately omits the sweep's execution token and lease expiry.

The subsystem is optional and never authorizes publication. `changeStatus(documentId, 'published')` continues to work without a schedule row, including for an external orchestrator. When a row does exist, publication removes it as transactional consistency cleanup—schedule state is an effect of publishing, never an input to it.

### `delete(id)`

```ts
handle.delete(documentId: string): Promise<DeleteDocumentResult>
```

Soft-deletes every version and path row, appends audit data, reconciles tree edges where applicable, and then runs post-commit consumers. The result distinguishes a clean commit from a commit whose post-commit side effects failed. Do not retry a committed delete merely because a post-commit hook failed.

## Editorial metadata

These methods authorize against the `any` read mode and reject anonymous callers. They apply `beforeRead` so metadata cannot expose hidden rows.

```ts
handle.count(options?: { status?: string }): Promise<number>
handle.countByStatus(): Promise<Array<{ status: string; count: number }>>
```

`count()` is an editorial current-version workflow count, not a published-view equivalent of `find().meta.total`.

### `history(id, options?)`

```ts
handle.history<F>(documentId: string, options?: {
  locale?: string
  page?: number
  pageSize?: number
  order?: string
  desc?: boolean
}): Promise<FindResult<F>>
```

Every historical version is independently scoped through `beforeRead` before pagination and totals are returned.

### `findByVersion(versionId, options?)`

```ts
handle.findByVersion<F>(versionId: string, options?: {
  select?: string[]
  locale?: string
}): Promise<ClientDocument<F> | null>
```

The query is constrained to the handle's collection. Unknown, cross-collection, and predicate-hidden versions all return `null`.

### `auditLog(id, options?)`

```ts
handle.auditLog(documentId: string, options?: {
  page?: number
  pageSize?: number
  locale?: string
}): Promise<AuditLogPage>
```

Returns newest-first non-versioned system-field, status, tree, and deletion events. It returns an empty page when the access gate hides the document or the adapter lacks the optional audit query at runtime.

## Search

### Collection search

```ts
handle.search(options: {
  query: string
  matching?: SearchMatching
  locale?: string
  status?: 'published' | 'any'
  where?: QueryPredicate
  facets?: string[]
  limit?: number
  offset?: number
  hydrate?: boolean
}): Promise<ClientSearchResults>
```

The collection path is implied by the handle. `hydrate: true` attaches a shaped `ClientDocument` to each authorized hit.

### Zone search

```ts
client.search(options: {
  query: string
  zone: string
  matching?: SearchMatching
  locale?: string
  status?: 'published' | 'any'
  where?: QueryPredicate
  facets?: string[]
  limit?: number
  offset?: number
  hydrate?: boolean
}): Promise<ClientSearchResults>
```

The exact result, matching, facet, hydration, and authorization behavior is in [Search API](../06-search/03-search-api.md).

### Index maintenance

```ts
handle.indexDocument(documentId: string): Promise<void>
handle.removeFromIndex(documentId: string): Promise<void>
handle.reindex(): Promise<{
  collectionPath: string
  documents: number
  indexed: number
}>
```

`indexDocument()` mirrors published content for every configured locale and removes stale projections when the document is no longer publishable. It no-ops when the collection or provider is not configured for search. `removeFromIndex()` removes every locale projection for the document. `reindex()` requires the collection's reindex ability and rebuilds the complete collection projection.

These methods have different trust boundaries. `indexDocument()` requires published-read ability but bypasses `beforeRead` row predicates so lifecycle synchronization can see every published document. `removeFromIndex()` delegates directly to the provider without resolving a request context or checking an ability; reserve it for trusted lifecycle and maintenance code. `reindex()` requires the reindex ability, and its internal document reads also require published-read ability while bypassing `beforeRead`.

## Document trees

Every tree method requires `CollectionDefinition.tree: true`. Tree writes use the collection update ability; reads use the read ability and apply status and `beforeRead` at each structural edge.

### `placeTreeNode(id, options)`

```ts
handle.placeTreeNode(documentId: string, options: {
  parentDocumentId: string | null
  beforeDocumentId?: string | null
  afterDocumentId?: string | null
  reconcile?: boolean
}): Promise<{ orderKey: string }>
```

`beforeDocumentId` is the left neighbor, so the node lands immediately after it. `afterDocumentId` is the right neighbor, so the node lands immediately before it. Both are resolved within the target parent group. `reconcile` re-runs post-commit tree consumers for an otherwise exact no-op.

### `removeFromTree(id, options?)`

```ts
handle.removeFromTree(
  documentId: string,
  options?: { reconcile?: boolean }
): Promise<void>
```

Deletes the structural edge and makes the document unplaced. It does not delete the document or mint a version.

### `getSubtree(options?)`

```ts
handle.getSubtree<F>(options?: {
  rootDocumentId?: string | null
  depth?: number
  locale?: string
  select?: string[]
  status?: 'published' | 'any'
}): Promise<Array<{
  document: ClientDocument<F>
  depth: number
  children: TreeNode<F>[]
}>>
```

`rootDocumentId: null` reads the whole forest from collection roots. A value includes that document as the subtree root. Hidden or unpublished nodes break the structural spine; descendants are not promoted.

### `getAncestors(id, options?)`

```ts
handle.getAncestors<F>(documentId: string, options?: {
  locale?: string
  select?: string[]
  status?: 'published' | 'any'
}): Promise<ClientDocument<F>[]>
```

Returns ancestors root-first and excludes the queried document. Visibility breaks truncate the chain.

### `getTreeParent(id, options?)`

```ts
handle.getTreeParent(documentId: string, options?: {
  locale?: string
  status?: 'published' | 'any'
}): Promise<{
  placed: boolean
  parentDocumentId: string | null
  parentVisibility: 'none' | 'visible' | 'redacted'
}>
```

`placed: false` means unplaced. `placed: true` with no parent means root. A visible child whose parent is hidden remains placed, but the parent ID is redacted.

[Document trees](../04-collections/04-document-trees.md) documents the storage model, mutation guarantees, audit behavior, invalidation, and authoring UI.
