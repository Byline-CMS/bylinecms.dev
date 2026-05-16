# Client SDK (`@byline/client`)

> Companions:
> - [ROUTING-API.md](./ROUTING-API.md) — broader transport-phase context: admin UI is the only client today, stable HTTP is deferred. The SDK is what fills the gap.
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — storage primitives the SDK sits above.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `populate` / `depth` machinery the SDK exposes.
> - [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — `RequestContext` threading and `beforeRead` / `afterRead` enforcement.
> - [COLLECTIONS.md](./COLLECTIONS.md) — `CollectionAdminConfig.preview.url` builder used by the admin preview affordance.
> - [`packages/client/DESIGN.md`](../packages/client/DESIGN.md) — implementation-detail design doc; phase-by-phase status snapshot.

## Overview

`@byline/client` is an **in-process, server-side SDK** for querying and mutating Byline documents. It sits above the storage primitives (`IDbAdapter`) and the `document-lifecycle` services, and exposes a richer DSL than the adapter alone: field-level filters, sort, pagination, populate, status awareness, and automatic `beforeRead` / `afterRead` hook firing. It is *not* a browser-safe SDK, *not* a public HTTP client, and *not* a framework-agnostic network transport client.

The distinction matters because Byline today is in an internal transport phase (see [ROUTING-API.md](./ROUTING-API.md)). The admin UI is the only active client, TanStack Start server functions are the internal transport boundary, and stable/public HTTP transport is intentionally deferred until the first real non-admin client arrives. `@byline/client` fits that phase well — it lives in the same Node process as Byline Core, holds direct references to the configured DB and storage adapters, and does no network I/O of its own.

What this gives consumers in trusted runtimes:

- A read DSL with field-level filters, sort, pagination, populate, and status awareness.
- A write surface (`create`, `update`, `delete`, `changeStatus`, `unpublish`) that delegates to `document-lifecycle` services.
- Response shaping into a public `ClientDocument<F>` envelope (camelCase, predictable, generic over the schema's field type).
- Automatic `beforeRead` predicate application and `afterRead` hook firing.
- Transparent `published` / `any` read-mode handling, including through populate.

What it does *not* do: speak HTTP, run in browsers, or hide the trust boundary. `actor: null` is allowed only for `read` with `readMode: 'published'`; everything else needs a real `RequestContext`.

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end points at the deeper architecture section. The patterns mirror the working `news` module in `apps/webapp/src/modules/news/`.

### 1. List documents (paginated, sorted)

The simplest list shape — sort, page size, locale, preview-aware status. Returns `FindResult<F>` (`{ docs, meta }`).

**Edit:** `apps/webapp/src/modules/<your-collection>/list.ts` (a server fn).

```ts
import { createServerFn } from '@tanstack/react-start'
import type { FindResult } from '@byline/client'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

export type NewsCategoriesListResult = FindResult<NewsCategoryFields>

export const getNewsCategoriesFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { lng?: string } | undefined) => ({ lng: input?.lng }))
  .handler(async (ctx): Promise<NewsCategoriesListResult> => {
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news-categories').find<NewsCategoryFields>({
      sort: { name: 'asc' },
      pageSize: 200,
      locale: ctx.data.lng,
      status: preview ? 'any' : 'published',
    })
  })
```

→ [Read surface](#read-surface)

### 2. List with a relation filter and populate

Filter by a relation target's column (here `category.path`), populate the relation and another image relation for in-page rendering, paginate.

**Edit:** `apps/webapp/src/modules/<your-collection>/list.ts`.

```ts
import type { FindResult, WithPopulated } from '@byline/client'
import type { MediaFields } from '~/collections/media/schema.js'
import type { NewsFields } from '~/collections/news/schema.js'
import type { NewsCategoryFields } from '~/collections/news-categories/schema.js'

type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsListResult = FindResult<NewsListFields>

export const getNewsListFn = createServerFn({ method: 'GET' })
  .inputValidator(/* … category?, page?, pageSize?, lng? */)
  .handler(async (ctx): Promise<NewsListResult> => {
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news').find<NewsListFields>({
      where: ctx.data.category ? { category: { path: ctx.data.category } } : undefined,
      sort: { publishedOn: 'desc' },
      populate: { category: '*', featureImage: '*' },
      page: ctx.data.page,
      pageSize: ctx.data.pageSize,
      locale: ctx.data.lng,
      status: preview ? 'any' : 'published',
    })
  })
```

The `where: { category: { path: ... } }` is a *cross-collection relation filter* — `path` is locale-resolved against the target's `byline_document_paths` row. See [Filtering](#filtering).

→ [Read surface](#read-surface) · [Relation filters](#filtering) · [`WithPopulated` typing](#typing-populated-relations)

### 3. Find one document by path

For document-detail routes. `findByPath` resolves through `byline_document_paths` (locale-aware) and returns `ClientDocument<F> | null`.

**Edit:** `apps/webapp/src/modules/<your-collection>/detail.ts`.

```ts
import type { ClientDocument, WithPopulated } from '@byline/client'

type NewsDetailFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

export type NewsDetailResult = ClientDocument<NewsDetailFields> | null

export const getNewsDetailFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { path: string; lng?: string }) => input)
  .handler(async (ctx): Promise<NewsDetailResult> => {
    const client = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news').findByPath<NewsDetailFields>(ctx.data.path, {
      populate: { category: '*', featureImage: '*' },
      locale: ctx.data.lng,
      status: preview ? 'any' : 'published',
    })
  })
```

Populated relations are addressable as `result.fields.category?.document?.fields.name` etc. — `WithPopulated` makes the chain fully typed.

→ [Read surface](#read-surface)

### 4. Find one document by id

When you already have the document id (e.g. from an admin route param) and want the same SDK semantics as `findByPath`.

```ts
const doc = await client.collection('news').findById<NewsDetailFields>(id, {
  populate: { category: '*' },
  locale: lng,
  status: preview ? 'any' : 'published',
})
```

Returns `ClientDocument<F> | null`. The `id` is the logical document id (UUID), not a version id.

→ [Read surface](#read-surface)

### 5. Find first match (`findOne`)

Equivalent to `find({ ..., pageSize: 1 }).docs[0] ?? null`, but communicates intent and skips the count query when supported.

```ts
const featured = await client.collection('news').findOne<NewsListFields>({
  where: { featured: true, status: 'published' },
  sort: { publishedOn: 'desc' },
  populate: { featureImage: '*' },
})
```

Returns `ClientDocument<F> | null`.

→ [Read surface](#read-surface)

### 6. Count documents

Returns `number`. Reads through the same status / locale / `beforeRead` machinery as `find()`, so it's a safe denominator for pagination.

```ts
const total = await client.collection('news').count({
  where: { category: { path: 'press' } },
  status: 'published',
})
```

→ [Read surface](#read-surface)

### 7. Filter with `$or` / `$and` combinators

Combinators wrap an array of sub-clauses. Field clauses inside a combinator behave the same as at the top level.

```ts
where: {
  $or: [
    { status: 'published' },
    { authorId: actor.id },
  ],
}
```

`status` and `path` inside a combinator (or inside a nested relation sub-clause) downshift from EAV-style `EXISTS` filters to direct outer-scope column comparisons via `DocumentColumnFilter` — so combinator clauses on document metadata compose correctly with field filters.

→ [Filtering](#filtering)

### 8. Filter on a relation target's columns

`where: { <relation>: { <field>: ... } }` is the cross-collection relation filter form. The target collection's filter machinery runs at the inner depth. `path` resolves through the target's `byline_document_paths` row (locale-aware).

```ts
// "News articles whose category's path is 'press'"
where: { category: { path: 'press' } }

// "News whose category's parent's path is 'editorial' — 2-hop"
where: { category: { parent: { path: 'editorial' } } }

// "News whose category's `slug` field is 'press'"
where: { category: { slug: 'press' } }
```

`status` and `path` inside a nested sub-clause are document metadata, not field filters. A target collection that declares a `path` or `status` *field* won't see those clauses resolve as field filters — rename the field if that ever bites (e.g. `slug`).

→ [Filtering](#filtering)

### 9. Type a populated relation with `WithPopulated`

Schema-derived field types treat relation slots as the unpopulated wire shape (`RelatedDocumentValue`). `WithPopulated<Fields, 'name', TargetFields>` overlays the populated envelope so `result.fields.name?.document?.fields.<field>` is fully typed.

**Edit:** the same `list.ts` / `detail.ts` server fn.

```ts
import type { WithPopulated } from '@byline/client'

type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>
```

The pattern composes — wrap once per relation. The pass-through is purely at the type level; you still need a matching `populate: { category: '*' }` at the call site for the runtime envelope to actually be populated.

→ [Typing populated relations](#typing-populated-relations)

### 10. Preview-aware reads

Editors need to see drafts on the public host without leaking them to ordinary visitors. The viewer client's `requestContext` upgrades to an admin actor when **both** the `byline_preview` cookie and a valid admin session resolve. `isPreviewActive()` performs the paired check; reads pass `status: 'any'` (admin sees drafts) or `'published'` (everyone else).

**Edit:** any server fn that should honour editorial preview.

```ts
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

const client = getViewerBylineClient()
const preview = await isPreviewActive()

await client.collection('news').find({
  // ...where / sort / populate / page / pageSize ...
  status: preview ? 'any' : 'published',
})
```

A stale cookie is failure-mode-neutral: it never escalates a non-admin request, and it never breaks one either. Preview is per-server-fn opt-in — a fn that doesn't pass `status: 'any'` always serves published content even with the cookie set.

→ [Preview mode](#preview-mode-admin-draft-viewing-on-the-public-host)

### 11. Choose the right viewer client

Three module-scoped singletons live next to each other under `@byline/host-tanstack-start/integrations/`. Pick by trust level at the call site rather than by configuring a single client.

| Helper | Behaviour | Use for |
|---|---|---|
| `getPublicBylineClient()` | Always anonymous + `readMode: 'published'`. Never reads the preview cookie. Never elevates. | RSS, sitemaps, JSON endpoints exposed to third parties, any response a CDN / cache might serve without keying off `byline_preview`. |
| `getViewerBylineClient()` | Anonymous + `'published'` by default; upgrades to admin actor when both the cookie *and* a valid admin session resolve. | User-facing public pages where editorial preview should be honoured. |
| `getAdminBylineClient()` | Resolves a fresh `RequestContext` from the admin session cookie on every call. Throws if no admin actor resolves. | Admin server fns and admin-only loaders. |

A viewer-client call that doesn't pass `status: 'any'` behaves identically to a public-client call. The viewer client is therefore strictly safe to default to on user-facing pages — the worst case is "preview cookie does nothing." Reach for the public client when "preview should never apply" is a load-bearing property.

→ [Preview mode](#preview-mode-admin-draft-viewing-on-the-public-host)

### 12. Create / update / delete (write surface)

Writes delegate to the corresponding `document-lifecycle` service, so collection hooks (`beforeCreate`, `afterUpdate`, etc.) fire identically to the admin UI write path. `update` accepts whole-document `data`; `patches` is admin-internal.

**Edit:** any server fn or trusted-runtime caller.

```ts
// Create
const created = await client.collection('news').create({
  data: { title: 'New piece', summary: '…' },
  locale: 'en',
  status: 'draft',                          // optional; defaults to the workflow's first status
  _requestContext: requestContext,
})

// Update
await client.collection('news').update(id, {
  data: { title: 'Revised title' },
  locale: 'en',
  _requestContext: requestContext,
})

// Workflow transition
await client.collection('news').changeStatus(id, { from: 'draft', to: 'published' })

// Delete
await client.collection('news').delete(id)
```

The public surface is whole-document only — patches (`field.*`, `array.*`, `block.*`) are admin-UI internal.

→ [Write surface](#write-surface)

### 13. Use the SDK from a migration or seed

Standalone construction — no `initBylineCore()` required. Pass a `createSuperAdminContext` so the explicit super-admin path stays auditable.

**Edit:** any script under `apps/webapp/byline/seeds/` or a migration runner.

```ts
import { createBylineClient } from '@byline/client'
import { createSuperAdminContext } from '@byline/auth'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'

import { collections } from '../byline/collections'

const client = createBylineClient({
  db: pgAdapter({ connectionString: process.env.BYLINE_DB_URL! }),
  collections,
  storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' }),
})

const ctx = createSuperAdminContext({ id: 'seed:initial-content' })

await client.collection('news').create({
  data: { title: 'Hello world' },
  _requestContext: ctx,
})
```

`createBylineClient` resolves a logger in priority order: explicit `config.logger` → `getLogger()` if `initBylineCore()` has registered one → silent no-op. Scripts and tests work without setup.

→ [Construction](#construction) · [Auth and the trust boundary](#auth-requestcontext-and-the-trust-boundary)

---

## Architecture

### Architectural position

```
┌──────────────────────────────────────────────────────────────────┐
│ Consumers (trusted runtime)                                      │
│   - TanStack Start route loaders / server functions              │
│   - server-side rendering paths inside the same deployment       │
│   - migrations, seeds, import/export jobs                        │
│   - operational tooling, scheduled jobs                          │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ @byline/client                                                   │
│   - BylineClient + CollectionHandle                              │
│   - WhereClause / SortClause / PopulateMap parsing               │
│   - shapeDocument()  → ClientDocument<F>                         │
│   - status mode default ('published') + threading                │
│   - calls beforeRead / afterRead at correct points               │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ @byline/core services                                            │
│   - document-lifecycle.ts  (create / update / delete / status)   │
│   - document-read.ts       (afterRead orchestration)             │
│   - populate.ts            (relation expansion)                  │
│   - apply-before-read.ts   (predicate compilation + cache)       │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Adapters                                                         │
│   IDbAdapter  (Drizzle/Postgres today)                           │
│   IStorageProvider  (local fs / S3)                              │
└──────────────────────────────────────────────────────────────────┘
```

The SDK does *not* sit at the same level as a future stable-HTTP client. Both can coexist — a future HTTP client would target the (yet-to-be-designed) public HTTP boundary; `@byline/client` continues to target adapters in-process.

### Construction

```ts
import { createBylineClient } from '@byline/client'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'
import { collections } from './byline/collections'

const client = createBylineClient({
  db: pgAdapter({ connectionString: process.env.BYLINE_DB_URL! }),
  collections,
  storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' }),
  // logger?: BylineLogger
})
```

`createBylineClient` is the standalone constructor. In an `initBylineCore()` setup the SDK can resolve its logger automatically through the registry; in scripts and tests it falls back to a silent no-op so callers don't have to wire `initBylineCore()` just to seed data.

The host adapter (`@byline/host-tanstack-start`) ships three module-scoped singletons over `getServerConfig()`: `getPublicBylineClient()`, `getViewerBylineClient()`, `getAdminBylineClient()` — see Quick Reference recipe 11. Each holds its own `collectionRecordCache` (so the path → `{ id, version }` lookup is amortised across the process lifetime) and serves fresh per-request `RequestContext` values via the SDK's per-call factory pattern.

### Read surface

Five top-level read methods, each returning camelCase-shaped `ClientDocument<F>` results:

```ts
client.collection('news').find({ where, sort, page, pageSize, fields, populate, depth, status, locale })
client.collection('news').findOne(opts)
client.collection('news').findById(id, opts)
client.collection('news').findByPath(path, opts)
client.collection('news').count({ where, status, locale })
```

### Filtering

`WhereClause` parses through `packages/core/src/query/parse-where.ts` (relocated from `@byline/client` so populate can compile predicates in-process):

```ts
// Field-level filters
where: { title: { $contains: 'launch' } }
where: { views: { $gte: 100 }, status: 'published' }
where: { publishedAt: { $lte: new Date().toISOString() } }

// Combinators
where: { $or: [{ status: 'published' }, { authorId: actor.id }] }
where: { $and: [{ tags: { $in: ['featured'] } }, { archived: false }] }

// Cross-collection relation filters
where: { category: { slug: 'news' } }              // target's `slug` field === 'news'
where: { category: { path: 'news' } }              // target document's path (locale-resolved via `byline_document_paths`) === 'news'
where: { category: { status: 'draft' } }           // target version's `document_versions.status` column === 'draft'
where: { category: { parent: { path: 'news' } } }  // 2-hop, doc-column at depth 2
```

The compiler emits `EXISTS` subqueries against the typed `store_*` tables for field filters, and depth-scoped nested `EXISTS` joins through `store_relation` for relation sub-wheres. All filter predicates respect the read mode — published-mode reads use `current_published_documents` even at the inner side of a relation join.

Document-level reserved keys (`status`, `path`) inside a nested sub-clause are document metadata, not field filters — same precedence as the top level, with no field-shadow exception (a target collection that declares a `path` or `status` field will not see those clauses resolve as field filters; rename the field, e.g. to `slug`). `status` resolves to `document_versions.status` on the relation hop's target row; `path` resolves through a `byline_document_paths` subquery against the hop's `document_id` (locale-resolved via the request's `[requested, default]` priority chain). `query` (text search) is not supported inside a nested sub-clause and is silently dropped with a debug log.

### Sorting

```ts
sort: 'publishedAt'             // ascending
sort: '-publishedAt'            // descending
sort: ['-publishedAt', 'title'] // multi-key
sort: { publishedAt: 'desc' }   // object form (used in the news example)
```

Field sort compiles to `LEFT JOIN LATERAL` against the appropriate store; document-level columns (`status`, `created_at`, `updated_at`) use direct outer-scope comparisons. Sorting by `path` is intentionally not supported (`path` lives in `byline_document_paths` and is locale-resolved per request); reintroduce via the `pathProjection` subquery if a real consumer surfaces.

### Selective field loading

```ts
fields: ['title', 'publishedAt', 'heroImage']
```

Cuts the 7-way `UNION ALL` to just the stores those fields use, then trims the response to the requested keys. See [CORE-DOCUMENT-STORAGE.md § Selective field loading](./CORE-DOCUMENT-STORAGE.md#selective-field-loading) for the full pipeline.

### Population

```ts
populate: true                                              // every relation, default projection
populate: '*'                                               // every relation, full doc, recursive
populate: { heroImage: true, author: { populate: { dept: true } } }
depth: 2                                                    // default 1 when populate present
```

The default projection includes the target's `useAsTitle` field implicitly, so widgets that render link labels keep working even if the caller's `select` didn't ask for it. See [RELATIONSHIPS.md § Populate](./RELATIONSHIPS.md#populate).

### Typing populated relations

Schema-derived field types treat relation slots as the unpopulated wire shape (`RelatedDocumentValue`). To get full type checking on `doc.fields.<relation>?.document?.fields.<field>`, overlay each populated relation with `WithPopulated`:

```ts
import type { WithPopulated } from '@byline/client'

type NewsListFields = WithPopulated<
  WithPopulated<NewsFields, 'category', NewsCategoryFields>,
  'featureImage',
  MediaFields
>

// Use as the generic:
await client.collection('news').find<NewsListFields>({ populate: { category: '*', featureImage: '*' } })
```

The wrapper is purely at the type level — you still need a matching `populate: { … }` at the call site for the runtime envelope to actually be populated. `WithPopulated` makes the *type* match what populate gives you back.

### Status awareness

```ts
status: 'published'             // default in @byline/client
status: 'any'                   // admin / system code paths
```

In `'published'` mode every read — including populate of relation targets and `findByPath` resolution — hits `current_published_documents`. A document with a newer unpublished draft over a previously-published version keeps returning the published content; the new draft becomes visible only once it's itself published.

`status` selects the **source view**, not an exact-status filter. `where.status` is a literal column filter and composes orthogonally:

```ts
// "Show me draft rows under the latest version, regardless of publish state"
client.collection('news').find({ status: 'any', where: { status: 'draft' } })
```

### Preview mode (admin draft viewing on the public host)

Editorial workflows usually want one extra capability: an admin should be able to navigate the public host pages and see their **own in-progress drafts** rendered exactly as the published version would be — without changing routes, without rebuilding markup, and without leaking drafts to ordinary visitors. `@byline/host-tanstack-start` ships a "viewer client" that layers preview-aware behaviour over the SDK without changing it.

**The plumbing splits into two layers** — a transport layer (cookie + viewer client + server fns) that decides what each request sees, and a UX layer (admin shell affordances) that lets editors flip the cookie and discover the resulting state.

**Transport layer:**

| Piece | Location | Role |
|---|---|---|
| `byline_preview` cookie | `@byline/host-tanstack-start/auth/preview-cookies` | Session-level "I want to see drafts" flag. httpOnly. Mere presence is the signal — no payload to verify. |
| `getViewerBylineClient()` | `@byline/host-tanstack-start/integrations/byline-viewer-client` | Singleton `BylineClient` whose per-call `requestContext` factory upgrades to the admin actor when both the cookie and a valid admin session resolve. |
| `isPreviewActive()` | same module | Async check that returns `true` only when the cookie is set **and** `getAdminRequestContext()` resolves an admin. |
| `enablePreviewModeFn` / `disablePreviewModeFn` / `getPreviewStateFn` | `@byline/host-tanstack-start/server-fns/preview` | Toggle the cookie / read its current state. Enable requires a valid admin context; disable and state-read are unauthenticated. |

**UX layer:**

| Surface | Location | Role |
|---|---|---|
| Drawer toggle (`Preview ON / OFF`) | `@byline/host-tanstack-start/admin-shell/chrome/preview-toggle` | Source-of-truth indicator above Account in the admin menu drawer. Always visible, always reversible. Reflects cookie state via `getPreviewStateFn`. |
| `<PreviewLink>` | `@byline/host-tanstack-start/admin-shell/collections/preview-link` | Per-document external-link icon on the edit page header. On click: `enablePreviewModeFn()` then `window.open(url)`. Hides when `preview.url(doc)` returns `null`. |
| `CollectionAdminConfig.preview` | `defineAdmin(...)` in your collection's `admin.tsx` | `{ url(doc, { locale }) }` — see [COLLECTIONS.md § Preview URL](./COLLECTIONS.md#preview-url) for the full reference. |
| ContentAdminBar pill | `apps/webapp/src/ui/components/content-admin-bar.tsx` | Public-side "Preview" pill + "Exit Preview" button when the cookie is set. Threaded down from the public layout loader (`getPreviewStateFn`). Calls `disablePreviewModeFn` then `router.invalidate()` on exit. |

**Trust model.** The cookie is a *flag*, not a credential. The actual safety check is layered:

1. **Source-view selection is per-call.** The SDK's `resolveReadMode` defaults to `'published'` regardless of `RequestContext.readMode`, so a server fn must pass `status: 'any'` to surface drafts. There is no way to flip the source view through `RequestContext` alone.
2. **`status: 'any'` requires an actor.** `assertActorCanPerform` only permits `actor: null` on `read` when `readMode === 'published'`. So a stray query string or stale cookie that reaches `status: 'any'` without a valid admin throws `ERR_UNAUTHENTICATED` rather than leaking drafts.
3. **The viewer client elevates the actor only when the cookie *and* the session line up.** A signed-out browser carrying an old preview cookie still falls through to the anonymous + `'published'` context — worst case the cookie does nothing.

A stale cookie is therefore failure-mode-neutral: it never escalates a non-admin request, and it never breaks one either.

**Editorial UX flow.** The three UX surfaces compose into one flow: an editor clicks `<PreviewLink>` on a document's edit page (which enables the cookie and opens the public URL in a new tab); every other public page in that browser session now surfaces drafts; the drawer toggle makes the state glanceable and reversible; and the public-side `ContentAdminBar` pill offers "Exit Preview" from any draft-rendering page. The two-step "enable cookie, then navigate" deliberately avoids a `/routes/draft?url=...&secret=...` redirect handler — `enablePreviewModeFn` is itself the gate (it requires a valid admin session before setting the cookie), so no shared secret needs to ride in the URL.

**Limits and notes:**

- Preview is per-server-fn opt-in. A fn that does not pass `status: 'any'` always serves published content, even with the cookie set. This is deliberate: opt-in keeps the trust boundary visible in code.
- The double resolution cost (cookie check + JWT verify) only happens in active preview sessions — the no-cookie path is a single cookie read.
- Preview elevates `readMode` for the request, but it does **not** bypass `beforeRead` hooks. A multi-tenant or owner-only-drafts hook will still scope the rows the admin can see — preview just changes which version of those rows is returned.
- The cookie has a 24-hour `maxAge` — preview is meant to be a short-lived editorial mode, not a permanent state. Re-enabling is a one-click action.
- The same pattern works for any host fn — not just collection reads. Any server fn that wants the "promote to admin actor when preview is on" behaviour can compose `getViewerBylineClient` + `isPreviewActive` the same way.
- **Front-end caching caveat.** Byline doesn't ship a built-in cache layer, but anything in front of your host (CDN, route-level cache headers, an in-process LRU) needs to either key off the `byline_preview` cookie or skip caching entirely when it's set — otherwise a single admin's preview view can poison a public cache entry and leak drafts to the next visitor. The Payload analogue is Next.js's `__prerender_bypass` cookie that disables ISR for the session; the underlying constraint is the same.

### Write surface

```ts
client.collection('news').create({ data, locale, path?, status? })
client.collection('news').update(id, { data, patches?, locale, path? })
client.collection('news').delete(id)
client.collection('news').changeStatus(id, { from, to })
client.collection('news').unpublish(id)
```

Each method delegates to the corresponding `document-lifecycle` service. The handle resolves the collection id once, builds a `DocumentLifecycleContext`, and invokes the service — collection hooks (`beforeCreate`, `afterUpdate`, etc.) fire the same way they do when the admin UI writes.

**Patches stay admin-internal.** The `update` method accepts whole-document `data`, plus an optional `patches` array for the admin form's reordering / block-insertion flow. Public consumers should use whole-document writes; the patch families (`field.*`, `array.*`, `block.*`) are tied to UI intent and not part of the supported public surface.

**Logger resolution.** `BylineClient` resolves a `BylineLogger` in priority order: explicit `config.logger` → `getLogger()` if `initBylineCore()` has registered one → silent no-op. Migration scripts and tests work without setup.

### Auth, `RequestContext`, and the trust boundary

Every read and write path runs `assertActorCanPerform` (for documents) or `assertActorCanPerform` plus the field-upload `create` gate (for uploads) before touching storage. The SDK accepts `RequestContext` on its read methods via an internal `_requestContext?` channel that admin call sites populate via `getAdminRequestContext`; standalone consumers can construct one explicitly:

```ts
import { createSuperAdminContext } from '@byline/auth'

const ctx = createSuperAdminContext({ id: 'migration-script' })
await client.collection('news').create({ data: { ... }, _requestContext: ctx })
```

Policy:

- **No context** → `ERR_UNAUTHENTICATED` on every method.
- **`actor: null`** → permitted only on `read` with `readMode: 'published'`. Any write or non-published read with a null actor throws.
- **Otherwise** → `actor.assertAbility('collections.<path>.<verb>')`. Super-admin (`actor.isSuperAdmin === true`) short-circuits.

The same `_bypassBeforeRead: true` escape hatch on read options is available for admin tooling that needs to see everything regardless of `beforeRead` scoping. Use sparingly; it's a deliberate exit from access control. See [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) for the full auth subsystem.

### Read-time hooks

Two collection-level hooks fire automatically through the SDK:

- **`beforeRead`** — called once per `find*` call (and once per populate batch per target collection), before any DB work. Returns a `QueryPredicate` AND-merged into the SQL. Per-`ReadContext` cache (`beforeReadCache`) ensures async hooks run once per collection per request. See [AUTHN-AUTHZ.md § Read-side scoping](./AUTHN-AUTHZ.md#read-side-scoping--the-beforeread-hook) (the Quick Reference there carries six worked recipes).
- **`afterRead`** — called once per materialised document on every read path and once per populated relation target. `ReadContext.afterReadFired` enforces "at most once per logical request" (A→B→A foreclosure). Mutations to `doc.fields` propagate into the shaped response.

Hooks share `ReadContext` with populate: a relation field and a richtext document link pointing at the same target cost one materialisation, not two.

---

## Use cases the SDK fits today

- **Server-side frontend rendering** in an all-in-one Byline deployment (TanStack Start route loaders, server functions, server-rendered page composition).
- **Migrations and seeds** — a script can construct a `BylineClient` plus a super-admin context and write through `document-lifecycle` like any other caller.
- **Import / export jobs** — read or write at scale, with the same hook semantics as production.
- **Operational tooling and admin scripts** — anything running in Node alongside the core.
- **Future write helpers in trusted runtimes** — uploads from disk, scheduled republish jobs, automated content ops.

In all of these the trust boundary is the Node process itself; the SDK is a convenience layer over the same core services that admin server functions call.

## What the SDK does *not* trigger

The presence (or growth) of `@byline/client` does **not** mean Byline now needs a stable/public HTTP API. Even adding write capability — including uploads from filesystem or stream sources in trusted Node code — keeps the SDK on the in-process side of the boundary.

The trigger for a stable HTTP API is the arrival of the first real client that **cannot safely or practically** consume adapters in-process. Examples: a mobile app, a desktop app, a separately-deployed frontend, an external integration, a hosted remote Byline service. When that happens, uploads are not the only concern — the same boundary has to cover reads, list/find, create/update/delete, status transitions, version history, and auth. That is why the stable HTTP boundary is designed as a broader phase of work, not an accidental side-effect of the SDK gaining methods.

See [ROUTING-API.md § What triggers a stable HTTP boundary](./ROUTING-API.md#what-triggers-a-stable-http-boundary) for the full discussion.

## Two clients, eventually

When stable HTTP arrives, two distinct client shapes will coexist:

- **In-process SDK** — `@byline/client` as it stands today. Trusted runtime, direct `IDbAdapter` / `IStorageProvider` access, richer server-side ergonomics, no network I/O.
- **Transport client** — a future thin fetch-based client over the public HTTP boundary. Browser-safe or remote-runtime-safe, no direct adapters, identical query DSL where possible but a different construction surface.

These are not the same package and should not be conflated. In-process SDK evolution should not accidentally define the public API; the public API is designed when the first external client forces the question.

## Working rule for the current phase

- Continue evolving `@byline/client` as an in-process, server-side SDK.
- Allow read-first, then write capabilities, inside trusted runtimes.
- Use it freely for migrations, seeds, server-rendered pages, scheduled jobs, operational tooling.
- Do not let SDK feature growth drag a public HTTP boundary forward — that boundary needs the broader transport-design pass.
- Introduce stable HTTP only when a real external client makes the in-process model untenable.

## Code map

| Concern | Location |
|---|---|
| `BylineClient` + `createBylineClient` | `packages/client/src/client.ts` |
| `CollectionHandle` | `packages/client/src/collection-handle.ts` |
| Public types (`ClientDocument`, `FindResult`, `WithPopulated`, options) | `packages/client/src/types.ts` |
| Response shaping | `packages/client/src/response.ts` |
| `WhereClause` / sort / relation filters | `packages/core/src/query/parse-where.ts` |
| `populateDocuments` orchestration | `packages/core/src/services/populate.ts` |
| `afterRead` orchestration | `packages/core/src/services/document-read.ts` |
| `beforeRead` predicate application | `packages/core/src/auth/apply-before-read.ts` |
| Document write services | `packages/core/src/services/document-lifecycle.ts` |
| `current_published_documents` view | `packages/db-postgres/src/database/migrations/0000_*.sql` |
| Public client (no preview) | `packages/host-tanstack-start/src/integrations/byline-public-client.ts` |
| Viewer client + `isPreviewActive` | `packages/host-tanstack-start/src/integrations/byline-viewer-client.ts` |
| Admin client | `packages/host-tanstack-start/src/integrations/byline-client.ts` |
| Preview cookie helpers | `packages/host-tanstack-start/src/auth/preview-cookies.ts` |
| Preview enable/disable/state server fns | `packages/host-tanstack-start/src/server-fns/preview/` |
| Drawer toggle | `packages/host-tanstack-start/src/admin-shell/chrome/preview-toggle.tsx` |
| `<PreviewLink>` + `resolvePreviewUrl` | `packages/host-tanstack-start/src/admin-shell/collections/preview-link.tsx` |
| `CollectionAdminConfig.preview` type | `packages/core/src/@types/admin-types.ts` |
| ContentAdminBar pill | `apps/webapp/src/ui/components/content-admin-bar.tsx` |
| Reference news list server fn | `apps/webapp/src/modules/news/list.ts` |
| Reference news detail server fn | `apps/webapp/src/modules/news/detail.ts` |
| Reference news categories server fn | `apps/webapp/src/modules/news/categories.ts` |
| Implementation-detail design notes | `packages/client/DESIGN.md` |
| Integration test suite | `packages/client/tests/integration/` |
