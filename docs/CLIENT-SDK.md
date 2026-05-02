# Client SDK (`@byline/client`)

> Companions:
> - [ROUTING-API.md](./ROUTING-API.md) — the broader transport-phase context: admin UI is the only client today, stable HTTP is deferred. The SDK is what fills the gap.
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — the storage primitives the SDK sits above.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `populate` / `depth` machinery that the SDK exposes.
> - [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — `RequestContext` threading and `beforeRead` / `afterRead` enforcement.
> - [`packages/client/DESIGN.md`](../packages/client/DESIGN.md) — implementation-detail design doc; phase-by-phase status snapshot.

## Overview

`@byline/client` is an **in-process, server-side SDK** for querying and mutating Byline documents. It is a higher-level API layered above the storage primitives (`IDbAdapter`) and the `document-lifecycle` services. It is *not* a browser-safe SDK, *not* a public HTTP client, and *not* a framework-agnostic network transport client.

The distinction matters because Byline today is in an internal transport phase (see [ROUTING-API.md](./ROUTING-API.md)): the admin UI is the only active client, TanStack Start server functions are the internal transport boundary, and stable/public HTTP transport is intentionally deferred until the first real non-admin client arrives. `@byline/client` fits that phase well — it lives in the same Node process as Byline Core, holds direct references to the configured DB and storage adapters, and does no network I/O of its own.

What this gives consumers in trusted runtimes:

- A read DSL with field-level filters, sort, pagination, populate, and status awareness.
- A write surface (`create`, `update`, `delete`, `changeStatus`, `unpublish`) that delegates to `document-lifecycle` services.
- Response shaping into a public `ClientDocument<F>` envelope (camelCase, predictable, generic over the schema's field type).
- Automatic `beforeRead` predicate application and `afterRead` hook firing.
- Transparent `published` / `any` read-mode handling, including through populate.

What it does *not* do:

- Speak HTTP. It calls adapters directly.
- Run in browsers. It assumes a Node-style runtime with full server-side dependencies.
- Hide the trust boundary. `actor: null` is allowed for `read` with `readMode: 'published'`; everything else needs a real `RequestContext`.

## Architectural position

```
┌──────────────────────────────────────────────────────────────────┐
│ Consumers (trusted runtime)                                      │
│   - TanStack Start route loaders / server functions              │
│   - server-side rendering paths inside the same deployment       │
│   - migrations, seeds, import/export jobs                        │
│   - operational tooling, scheduled jobs                          │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ @byline/client                                                   │
│   - BylineClient + CollectionHandle                              │
│   - WhereClause / SortClause / PopulateMap parsing               │
│   - shapeDocument()  → ClientDocument<F>                         │
│   - status mode default ('published') + threading                │
│   - calls beforeRead / afterRead at correct points               │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ @byline/core services                                            │
│   - document-lifecycle.ts  (create / update / delete / status)   │
│   - document-read.ts       (afterRead orchestration)             │
│   - populate.ts            (relation expansion)                  │
│   - apply-before-read.ts   (predicate compilation + cache)       │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Adapters                                                         │
│   IDbAdapter  (Drizzle/Postgres today)                           │
│   IStorageProvider  (local fs / S3)                              │
└──────────────────────────────────────────────────────────────────┘
```

The SDK does *not* sit at the same level as a future stable-HTTP client. Both can coexist — a future HTTP client would target the (yet-to-be-designed) public HTTP boundary; `@byline/client` continues to target adapters in-process.

## Construction

```ts
import { createBylineClient } from '@byline/client'
import { pgAdapter } from '@byline/db-postgres'
import { localStorageProvider } from '@byline/storage-local'
import { collections } from './byline/collections'

const client = createBylineClient({
  db: pgAdapter({ connectionString: process.env.BYLINE_DB_URL! }),
  collections,
  storage: localStorageProvider({ uploadDir: './public/uploads', baseUrl: '/uploads' }),
  // logger?: BylineLogger     // priority: explicit → getLogger() → silent no-op
})
```

`createBylineClient` is the standalone constructor. In an `initBylineCore()` setup the client can resolve its logger automatically through the registry; in scripts and tests it falls back to a silent no-op so callers don't have to wire `initBylineCore()` just to seed data.

## Read surface

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

// Cross-collection relation filters (Phase 6 semantics)
where: { category: { path: 'news' } }              // category target's path === 'news'
where: { category: { parent: { path: 'news' } } }  // 2-hop
```

The compiler emits `EXISTS` subqueries against the typed `store_*` tables for field filters, and depth-scoped nested `EXISTS` joins through `store_relation` for relation sub-wheres. All filter predicates respect the read mode — published-mode reads use `current_published_documents` even at the inner side of a relation join.

### Sorting

```ts
sort: 'publishedAt'             // ascending
sort: '-publishedAt'            // descending
sort: ['-publishedAt', 'title'] // multi-key
```

Field sort compiles to `LEFT JOIN LATERAL` against the appropriate store; document-level columns (`status`, `path`, `created_at`, `updated_at`) use direct outer-scope comparisons.

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

## Preview mode (admin draft viewing on the public host)

Editorial workflows usually want one extra capability: an admin should be able to navigate the public host pages and see their **own in-progress drafts** rendered exactly as the published version would be — without changing routes, without rebuilding markup, and without leaking drafts to ordinary visitors. `@byline/host-tanstack-start` ships a small "viewer client" that layers preview-aware behaviour over the SDK without changing it.

### How the pieces fit

The plumbing splits into two layers — a transport layer (cookie + viewer client + server fns) that decides what each request sees, and a UX layer (admin shell affordances) that lets editors flip the cookie and discover the resulting state.

**Transport layer:**

| Piece                                | Location                                                                          | Role                                                                                                              |
|--------------------------------------|-----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `byline_preview` cookie              | `@byline/host-tanstack-start/auth/preview-cookies`                                 | Session-level "I want to see drafts" flag. httpOnly. Mere presence is the signal — no payload to verify.          |
| `getViewerBylineClient()`            | `@byline/host-tanstack-start/integrations/byline-viewer-client`                    | Singleton `BylineClient` whose per-call `requestContext` factory upgrades to the admin actor when both the cookie and a valid admin session resolve. |
| `isPreviewActive()`                  | same module                                                                       | Async check that returns `true` only when the cookie is set **and** `getAdminRequestContext()` resolves an admin. |
| `enablePreviewModeFn` / `disablePreviewModeFn` / `getPreviewStateFn` | `@byline/host-tanstack-start/server-fns/preview` | Toggle the cookie / read its current state. Enable requires a valid admin context; disable and state-read are unauthenticated. |

**UX layer:**

| Surface                              | Location                                                                          | Role                                                                                                              |
|--------------------------------------|-----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| Drawer toggle (`Preview ON / OFF`)   | `@byline/host-tanstack-start/admin-shell/chrome/preview-toggle`                    | Source-of-truth indicator above Account in the admin menu drawer. Always visible, always reversible. Reflects cookie state via `getPreviewStateFn`. |
| `<PreviewLink>`                      | `@byline/host-tanstack-start/admin-shell/collections/preview-link`                 | Per-document external-link icon on the edit page header. On click: `enablePreviewModeFn()` then `window.open(url)`. Hides when `preview.url(doc)` returns `null`. |
| `CollectionAdminConfig.preview`      | `defineAdmin(...)` in your collection's `admin.tsx`                                | `{ populate?, url(doc, { locale }) }`. The populate hint guarantees `url(...)` sees resolved relation values; `url` returns the preview URL or `null`. Falls back to `/${collectionPath}/${doc.path}` when omitted. |
| ContentAdminBar pill                 | `apps/webapp/src/ui/components/content-admin-bar.tsx`                              | Public-side "Preview" pill + "Exit Preview" button when the cookie is set. Threaded down from the public layout loader (`getPreviewStateFn`). Calls `disablePreviewModeFn` then `router.invalidate()` on exit. |

### Trust model

The cookie is a *flag*, not a credential. The actual safety check is layered:

1. **Source-view selection is per-call.** The SDK's `resolveReadMode` defaults to `'published'` regardless of `RequestContext.readMode`, so a server fn must pass `status: 'any'` to surface drafts. There is no way to flip the source view through `RequestContext` alone.
2. **`status: 'any'` requires an actor.** `assertActorCanPerform` (packages/core/src/auth) only permits `actor: null` on `read` when `readMode === 'published'`. So a stray query string or stale cookie that reaches `status: 'any'` without a valid admin throws `ERR_UNAUTHENTICATED` rather than leaking drafts.
3. **The viewer client elevates the actor only when the cookie *and* the session line up.** A signed-out browser carrying an old preview cookie still falls through to the anonymous + `'published'` context — worst case the cookie does nothing.

A stale cookie is therefore failure-mode-neutral: it never escalates a non-admin request, and it never breaks a non-admin request either.

### Server fn pattern

```ts
import { createServerFn } from '@tanstack/react-start'
import {
  getViewerBylineClient,
  isPreviewActive,
} from '@byline/host-tanstack-start/integrations/byline-viewer-client'

export const getNewsListFn = createServerFn({ method: 'GET' })
  .inputValidator(/* ... */)
  .handler(async (ctx) => {
    const client  = getViewerBylineClient()
    const preview = await isPreviewActive()

    return client.collection('news').find({
      // ...where / sort / populate / page / pageSize ...
      status: preview ? 'any' : 'published',
    })
  })
```

Two lines of boilerplate per fn, and the trust boundary stays explicit at the call site. Authors who want to *force* one mode regardless of preview state simply hard-code `status: 'published'` (or `'any'`) — preview becomes opt-in per fn rather than ambient across the whole app.

### Toggling preview mode

Three places naturally need to flip the cookie — each backed by the same server fns:

```ts
import {
  enablePreviewModeFn,
  disablePreviewModeFn,
  getPreviewStateFn,
} from '@byline/host-tanstack-start/server-fns/preview'

// Drawer toggle / per-doc <PreviewLink> click — sets the cookie.
// Requires a valid admin context.
await enablePreviewModeFn()

// "Exit Preview" on the public-side bar — clears the cookie.
// Unauthenticated (anyone can clear their own cookie).
await disablePreviewModeFn()

// Drawer toggle / public-bar pill on mount — reads the current state.
const { preview } = await getPreviewStateFn()
```

The cookie has a 24-hour `maxAge` — preview is meant to be a short-lived editorial mode, not a permanent state. Re-enabling is a one-click action.

### Per-document preview links via `CollectionAdminConfig.preview`

Per-document preview links need to know *where* to send the editor. For collections whose public route is the conventional `/${collectionPath}/${path}` (e.g. `/news/<slug>`), the default is fine and no config is needed — `<PreviewLink>` synthesises the URL automatically.

For collections whose public URL depends on document context — a `pages` collection routed by an `area` relation, a `docs` collection prefixed by `version`, anything where the URL composes from more than just `path` — declare the URL composition on `defineAdmin`:

```ts
// apps/webapp/byline/collections/pages/admin.tsx
defineAdmin(Pages, {
  // ... columns, layout, etc.

  preview: {
    // Populate hint applied when the admin loads the doc for the
    // preview link. Guarantees `url(doc)` sees resolved relation
    // envelopes (`doc.fields.area?.document?.path`) instead of bare
    // `RelatedDocumentValue` refs.
    populate: { area: '*' },

    // Pure function — return null when there's no preview URL
    // meaningful for this doc yet. <PreviewLink> hides itself in
    // that case.
    url: (doc, { locale }) => {
      if (!doc.path) return null
      const area = doc.fields.area?.document?.path
      const prefix = locale && locale !== 'en' ? `/${locale}` : ''
      return area && area !== 'root'
        ? `${prefix}/${area}/${doc.path}`
        : `${prefix}/${doc.path}`
    },
  },
})
```

The function form (rather than a string template like `/[area.path]/[path]`) keeps conditionals first-class — you can branch on locale, status, missing relations, or anything else available in `doc` / `ctx`. Returning `null` is the clean way to say "no preview URL for this doc" — the icon hides; no broken `/undefined/...` links.

Returned URLs may be **relative** (`/news/foo`) for same-origin hosts or **absolute** (`https://www.example.com/news/foo`) for hosts deployed separately from the admin. `<PreviewLink>` opens whatever you return in a new tab via `window.open(url, '_blank', 'noopener,noreferrer')`.

### UX flow

The three UX surfaces compose into one editorial flow:

1. **Discover the affordance.** The `<PreviewLink>` icon sits in the document edit page header (next to History / Edit / API). One click enables preview mode and opens the document's public URL in a new tab — the editor sees their draft rendered exactly as the published version would be.
2. **See the global state.** Because `enablePreviewModeFn` sets a cookie, every other public page the admin visits in that browser session also surfaces drafts. The drawer toggle (`Preview ON / OFF`, above Account) makes that state glanceable and reversible.
3. **Exit from the public side.** While browsing the public site in preview mode, the `ContentAdminBar` shows a "Preview" pill + "Exit Preview" button. Clicking exit clears the cookie and `router.invalidate()`s the layout, so any drafts on screen revert to published immediately.

The two-step "enable cookie, then navigate" deliberately avoids a `/routes/draft?url=...&secret=...` redirect handler — `enablePreviewModeFn` is itself the gate (it requires a valid admin session before setting the cookie), so no shared secret needs to ride in the URL.

### Comparison with the public client

`getPublicBylineClient` (typically host-app-local — see `apps/webapp/src/lib/get-byline-client.ts`) is unconditionally anonymous + `'published'`. Use it where preview should never apply (RSS feeds, sitemap generators, third-party-facing endpoints, anywhere the response will be cached without a cookie key). Use `getViewerBylineClient` on user-facing public pages where an admin's session should be honoured.

### Limits and notes

- Preview is per-server-fn opt-in. A fn that does not pass `status: 'any'` will always serve published content, even with the cookie set. This is deliberate: opt-in keeps the trust boundary visible in code.
- The double resolution cost (cookie check + JWT verify) only happens in active preview sessions — the no-cookie path is a single cookie read.
- Preview elevates `readMode` for the request, but it does **not** bypass `beforeRead` hooks. A multi-tenant or owner-only-drafts hook will still scope the rows the admin can see — preview just changes which version of those rows is returned.
- The same pattern works for any host fn — not just collection reads. Any server fn that wants the "promote to admin actor when preview is on" behaviour can compose `getViewerBylineClient` + `isPreviewActive` the same way.
- **Front-end caching caveat.** Byline doesn't ship a built-in cache layer, but anything in front of your host (CDN, route-level cache headers, an in-process LRU) needs to either key off the `byline_preview` cookie or skip caching entirely when it's set — otherwise a single admin's preview view can poison a public cache entry and leak drafts to the next visitor. The Payload analogue is Next.js's `__prerender_bypass` cookie that disables ISR for the session; the underlying constraint is the same.
- The edit-page loader auto-populates direct relation fields at depth 1 with each target's `picker` projection, so `url(doc)` already sees populated `category`/`area`/etc envelopes carrying their column-level `path`. `preview.populate` is the future hook for cases where `url(doc)` needs to read **fields** of a populated relation (not just `path`) — wiring the loader to merge `preview.populate` on top of the default is a small follow-up task.

## Write surface

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

## Auth, `RequestContext`, and the trust boundary

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

The same `_bypassBeforeRead: true` escape hatch on read options is available for admin tooling that needs to see everything regardless of `beforeRead` scoping. Use sparingly; it's a deliberate exit from access control.

## Read-time hooks

Two collection-level hooks fire automatically through the SDK:

- **`beforeRead`** — called once per `find*` call (and once per populate batch per target collection), before any DB work. Returns a `QueryPredicate` AND-merged into the SQL. Per-`ReadContext` cache (`beforeReadCache`) ensures async hooks run once per collection per request. See [AUTHN-AUTHZ.md § Read-side scoping](./AUTHN-AUTHZ.md#read-side-scoping--the-beforeread-hook) and the [Access Control Recipes](./ACCESS-CONTROL-RECIPES.md).
- **`afterRead`** — called once per materialised document on every read path and once per populated relation target. `ReadContext.afterReadFired` enforces "at most once per logical request" (A→B→A foreclosure). Mutations to `doc.fields` propagate into the shaped response.

Hooks share `ReadContext` with populate: a relation field and a richtext document link pointing at the same target cost one materialisation, not two.

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

| Concern                                  | Location                                                     |
|------------------------------------------|--------------------------------------------------------------|
| `BylineClient` + `createBylineClient`    | `packages/client/src/client.ts`                              |
| `CollectionHandle`                       | `packages/client/src/collection-handle.ts`                   |
| Public types (`ClientDocument`, options) | `packages/client/src/types.ts`                               |
| Response shaping                         | `packages/client/src/response.ts`                            |
| `WhereClause` / sort / relation filters  | `packages/core/src/query/parse-where.ts`                     |
| `populateDocuments` orchestration        | `packages/core/src/services/populate.ts`                     |
| `afterRead` orchestration                | `packages/core/src/services/document-read.ts`                |
| `beforeRead` predicate application       | `packages/core/src/auth/apply-before-read.ts`                |
| Document write services                  | `packages/core/src/services/document-lifecycle.ts`           |
| `current_published_documents` view       | `packages/db-postgres/src/database/migrations/0000_*.sql`    |
| Preview cookie helpers                   | `packages/host-tanstack-start/src/auth/preview-cookies.ts`   |
| Viewer client + `isPreviewActive`        | `packages/host-tanstack-start/src/integrations/byline-viewer-client.ts` |
| Preview enable/disable/state server fns  | `packages/host-tanstack-start/src/server-fns/preview/`       |
| Drawer toggle                            | `packages/host-tanstack-start/src/admin-shell/chrome/preview-toggle.tsx` |
| `<PreviewLink>` + `resolvePreviewUrl`    | `packages/host-tanstack-start/src/admin-shell/collections/preview-link.tsx` |
| `CollectionAdminConfig.preview` type     | `packages/core/src/@types/admin-types.ts`                    |
| ContentAdminBar pill                     | `apps/webapp/src/ui/components/content-admin-bar.tsx`        |
| Implementation-detail design notes       | `packages/client/DESIGN.md`                                  |
| Integration test suite                   | `packages/client/tests/integration/`                         |
