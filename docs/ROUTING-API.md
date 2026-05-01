# Routing & API

> Companions:
> - [FILE-MEDIA-UPLOADS.md](./FILE-MEDIA-UPLOADS.md) — uploads ride on the same internal transport described here.
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — what the document write/read services persist.
> - [CLIENT-SDK.md](./CLIENT-SDK.md) — the in-process client that admin server fns and (future) public HTTP routes both delegate to.

## Overview

Byline is in an **internal transport phase**. The only active client today is the admin UI inside `apps/webapp`, so document, upload, and admin-management operations are exposed through **TanStack Start server functions** rather than a stable, framework-agnostic HTTP API.

This is deliberate. We explicitly do **not** want to evolve ad-hoc HTTP endpoints one operation at a time while the admin UI is the only client. Doing so would prematurely lock in a public API surface before we have the broader client requirements needed to design that surface coherently.

The architecture is four layers, top to bottom:

```
┌──────────────────────────────────────────────────────────────────┐
│ Admin UI (React + TanStack Router)                               │
│   apps/webapp/src/routes/{-$lng}/(byline)/...                    │
└──────────────────────────────────────────────────────────────────┘
                              │  invokes via @tanstack/react-start
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Server functions (transport layer)                               │
│   packages/host-tanstack-start/src/server-fns/<area>/<verb>.ts   │
│     - createServerFn({ method: 'GET' | 'POST' })                 │
│     - inputValidator(...)                                        │
│     - resolves RequestContext via getAdminRequestContext()       │
│     - serialises the result                                      │
└──────────────────────────────────────────────────────────────────┘
                              │  delegates to
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Core services (business logic, framework-agnostic)               │
│   packages/core/src/services/                                    │
│     - document-lifecycle.ts (create / update / status / delete)  │
│     - field-upload.ts       (validate / store / hooks / variants)│
│     - document-read.ts      (afterRead orchestration)            │
│     - populate.ts           (relation expansion)                 │
│   packages/admin/src/admin-{users,roles,permissions}/commands.ts │
│   packages/client/src/                                           │
│     - CollectionHandle (used by admin server fns and external    │
│       readers; routes through document-lifecycle for writes)     │
└──────────────────────────────────────────────────────────────────┘
                              │  uses injected adapter
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Infrastructure adapters                                          │
│   packages/db-postgres        IDbAdapter                         │
│   packages/storage-local/-s3  IStorageProvider                   │
│   packages/admin/-jwt-session JwtSessionProvider                 │
└──────────────────────────────────────────────────────────────────┘
```

The contract between layers is sharp: server fns own transport (input validation, auth-context resolution, serialisation); core services own business logic; adapters own persistence. Each server fn is a thin wrapper — a typical handler is 30–60 lines and delegates to one core service call.

## Current transport surface

Server functions live under `packages/host-tanstack-start/src/server-fns/` and are organised by area. Each file exports one or more `createServerFn`-wrapped handlers.

### `collections/` — document operations

Per-collection document operations against the universal storage layer. All of these route through `document-lifecycle.ts` (writes) or the `@byline/client` `CollectionHandle` (reads) and pass through the `assertActorCanPerform` ability check before touching storage.

| File          | Verb   | Purpose                                                                                          |
|---------------|--------|--------------------------------------------------------------------------------------------------|
| `list.ts`     | `GET`  | Paginated, sortable, filterable list view; respects `CollectionAdminConfig.columns`.             |
| `get.ts`     | `GET`  | Single document by id, with optional `populate` / `depth` / `locale`.                            |
| `create.ts`   | `POST` | Create document version from `{ data, patches }`.                                                |
| `update.ts`   | `POST` | Apply `DocumentPatch[]` to the current version, write a new version.                             |
| `delete.ts`   | `POST` | Soft-delete (lifecycle delete via the storage adapter).                                          |
| `status.ts`   | `POST` | Workflow transition (`PATCH-shape`); validates against `defineWorkflow` config.                  |
| `history.ts`  | `GET`  | Version history for a document.                                                                  |
| `stats.ts`    | `GET`  | Document counts grouped by status — feeds the dashboard cards.                                   |
| `upload.ts`   | `POST` | Field-level file upload; full pipeline documented in [FILE-MEDIA-UPLOADS.md](./FILE-MEDIA-UPLOADS.md). |
| `utils.ts`    | —      | `serialise()` helpers shared across the above.                                                   |

### `auth/` — sign-in / sign-out / session

| File              | Verb   | Purpose                                                          |
|-------------------|--------|------------------------------------------------------------------|
| `sign-in.ts`      | `POST` | Password + JWT issue via `JwtSessionProvider`.                   |
| `sign-out.ts`     | `POST` | Revoke refresh token, clear cookies.                             |
| `current-user.ts` | `GET`  | Resolve and return the current `AdminAuth` actor for the route.  |

### `admin-users/`, `admin-roles/`, `admin-permissions/`, `admin-account/`

Administrative management of the auth subsystem. Each handler delegates to the matching `*Command` in `@byline/admin/admin-{users,roles,permissions}` and is gated by `assertAdminActor` inside the command — so the transport wrappers themselves carry no policy.

| Area                | Files                                                                                       |
|---------------------|---------------------------------------------------------------------------------------------|
| `admin-users/`      | `create`, `update`, `delete`, `enable`, `disable`, `get`, `list`, `set-password`, `set-user-roles`, `get-user-roles` |
| `admin-roles/`      | `create`, `update`, `delete`, `get`, `list`, `reorder`                                      |
| `admin-permissions/`| `list`, `assign`, `revoke`, `who-has-ability`                                               |
| `admin-account/`    | `update-account` (the current actor's own profile)                                          |

(See `packages/host-tanstack-start/src/server-fns/admin-*/` for the canonical file list.)

## Anatomy of a server function

A representative handler — `collections/get.ts`:

```ts
const getDocumentFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; id: string; locale?: string; depth?: number }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id, locale, depth } = data
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) throw ERR_NOT_FOUND({ message: 'Collection not found', ... }).log(logger)

    const client = getAdminBylineClient()        // @byline/client, server-side
    const handle = client.collection(path)
    const doc = await handle.findById(id, { locale, depth, populate: ... })

    return serialise(doc)
  })
```

Three things to notice:

1. **No business logic here.** The handler resolves config, picks a populate strategy, and delegates. The actual `findById` work happens inside `CollectionHandle` → `document-read.ts` → adapter.
2. **Auth context is resolved per-call** via `getAdminRequestContext()` (write paths) — not at module load. This keeps the handler pure and lets the same wrapper run under different actors across requests.
3. **`serialise()`** turns dates and other non-JSON values into transport-safe shapes. The same helper is used across the `collections/` area.

For writes the pattern adds `requestContext` threading:

```ts
const createDocumentFn = createServerFn({ method: 'POST' })
  .inputValidator(parseCreateInput)
  .handler(async ({ data }) => {
    const lifecycleCtx = {
      db, definition, collectionId, ...,
      requestContext: await getAdminRequestContext(),
    }
    const result = await createDocument(lifecycleCtx, { data: data.fields, locale })
    return serialise(result)
  })
```

The `requestContext` is what `assertActorCanPerform` reads inside `document-lifecycle.ts` — the gate runs in the service, not in the transport. That keeps the policy enforcement on the same side of the wire as the business logic, so any future stable HTTP transport inherits the gate for free.

## The `@byline/client` indirection

Read paths in the admin webapp do not call the database adapter directly. They go through `@byline/client` (`CollectionHandle`) — the same in-process SDK a non-admin reader would use. This is intentional: it means admin reads exercise the same `beforeRead` hooks, the same `afterRead` shaping, and the same populate orchestration as future external clients. The transport layer is the only thing that changes when a stable HTTP boundary lands.

Writes go straight to `document-lifecycle.ts`. The client's write surface (`create` / `update` / `delete` / `changeStatus`) wraps the same lifecycle functions, so a future stable HTTP endpoint can be a thin shim around either path with no business-logic changes.

## What we deliberately do not have

There is **no stable, public, framework-agnostic HTTP API contract today** for any of these operations. Specifically:

- No `/api/<collection>` REST routes.
- No GraphQL endpoint.
- No OpenAPI / Swagger surface.
- No SDKs published for external use beyond the in-process `@byline/client`.

Everything goes through TanStack Start's server-function transport, which is conceptually closer to RPC than HTTP — the wire shape is an implementation detail of TanStack Start, not a contract Byline owns.

If we introduced a stable HTTP transport now only for one operation (e.g. uploads, or just `findById`), we would create a misleading partial boundary: that operation would have a public transport shape while everything around it would still be internal RPC. That split would force a later redesign once the first external client appeared.

## What triggers a stable HTTP boundary

The correct trigger is **the arrival of the first real non-admin client**. Plausible examples:

- a mobile app or desktop app that talks directly to a Byline backend
- a separately-deployed public frontend (not the admin webapp) that needs to read published content
- an external integration consuming or pushing content
- a hosted, multi-tenant Byline API server

Once that happens, uploads will not be the only concern. The same client will need stable transport for read, list, create, update, status, history, and the auth surface that gates them. The HTTP boundary should be designed as a **phase of work across the broader application surface**, not introduced incrementally around one feature.

The likely shape of that next phase:

1. Define stable HTTP contracts for upload, read, list, create, update, status, and history operations — including auth, error envelopes, and pagination.
2. Implement those HTTP transports as thin wrappers around the existing core services (the same delegation pattern the TanStack Start handlers already use).
3. Keep TanStack Start server functions for the admin UI if they remain useful internally — they're cheaper than a round-trip through the public HTTP layer.
4. Allow another host framework (Fastify, Hono, whatever) to expose the same HTTP contracts while still using `@byline/core` underneath. The `host-tanstack-start` package becomes one host among several rather than the only one.

At that point the architecture becomes:

```
client → chooses transport →
  stable HTTP route   (via packages/host-fastify, etc.)   ──┐
  internal server fn  (via packages/host-tanstack-start)  ──┼→ core services → adapters
  in-process client   (via @byline/client)                ──┘
```

## Architectural rules for the current phase

1. **Do not introduce stable / public HTTP API endpoints just because one operation looks transport-like.** If you find yourself reaching for one, the work belongs in the broader stable-HTTP phase, not in a one-off.
2. **Keep admin-only flows on TanStack Start server functions while the admin UI is the only client.** Add new operations as new server-fn files alongside the existing ones; do not invent a parallel transport.
3. **Move business logic into core services so a later stable HTTP transport can be added cleanly.** A new server fn should be a thin delegate: input validation, context resolution, one core-service call, serialisation. If the handler is doing real work, that work belongs in `@byline/core` or `@byline/admin`.
4. **Service-layer enforcement, not transport-layer enforcement.** Auth gates (`assertActorCanPerform` for documents, `assertAdminActor` for admin management) live inside the core/admin services. The transport just hands them a `RequestContext`. This keeps the same gate active no matter which transport invokes the service.
5. **Reads go through `@byline/client`.** Even from inside the admin webapp. This keeps `beforeRead` / `afterRead` / populate orchestration uniform with future external readers.

## Relationship to remote deployments

If Byline is later hosted behind a dedicated API server (e.g. a Fastify application), that server should expose the stable HTTP boundary and call the same core services. In that future model:

- TanStack Start is not required for external clients.
- TanStack server functions remain an internal convenience transport, not the public contract.
- The stable HTTP API is the framework-agnostic transport boundary.
- Hosts are pluggable: `host-tanstack-start` and a hypothetical `host-fastify` can coexist, exposing different transports over the same core services.

## Code map

| Concern                                  | Location                                                                  |
|------------------------------------------|---------------------------------------------------------------------------|
| Admin UI routes                          | `apps/webapp/src/routes/{-$lng}/(byline)/`                                |
| Document server fns (current transport)  | `packages/host-tanstack-start/src/server-fns/collections/`                |
| Auth server fns                          | `packages/host-tanstack-start/src/server-fns/auth/`                       |
| Admin-management server fns              | `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/` |
| Auth context resolver                    | `packages/host-tanstack-start/src/auth/auth-context.ts` (`getAdminRequestContext`) |
| Document write services                  | `packages/core/src/services/document-lifecycle.ts`                        |
| Field-level upload service               | `packages/core/src/services/field-upload.ts`                              |
| Document read services + hooks           | `packages/core/src/services/document-read.ts` + `populate.ts`             |
| Auth gates                               | `packages/core/src/auth/assert-actor-can-perform.ts`, `packages/admin/src/lib/assert-admin-actor.ts` |
| Admin-management commands                | `packages/admin/src/admin-{users,roles,permissions}/commands.ts`          |
| In-process client (used by admin reads)  | `packages/client/src/` + `packages/host-tanstack-start/src/integrations/byline-client.ts` |
