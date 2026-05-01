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
| Implementation-detail design notes       | `packages/client/DESIGN.md`                                  |
| Integration test suite                   | `packages/client/tests/integration/`                         |
