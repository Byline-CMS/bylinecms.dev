---
title: "Routing & API"
path: "routing-api"
summary: "The current internal-transport phase — TanStack Start server functions per area — and why a stable public HTTP API is deferred until a second client arrives."
---

# Routing & API

Companions:
- [Transports](./03-transports.md) — the concrete shape of the stable HTTP boundary this doc defers: a framework-agnostic operation contract bound to Nitro / Fastify / Hono, plus MCP as a peer transport.
- [File / Media Uploads](../04-collections/05-file-media-uploads.md) — uploads ride on the same internal transport described here.
- [Document Storage](../03-architecture/01-document-storage.md) — what the document write/read services persist.
- [Client SDK](./01-client-sdk.md) — the in-process client that admin server fns and (future) public HTTP routes both delegate to.

## Overview

Byline is in an **internal transport phase**. The only active client today is the admin UI inside `apps/webapp`, so document, upload, and admin-management operations are exposed through **TanStack Start server functions** rather than a stable, framework-agnostic HTTP API.

This is deliberate. Byline avoids evolving ad-hoc HTTP endpoints one operation at a time while the admin UI is the only client — doing so would prematurely lock in a public API surface before the broader client requirements needed to design it coherently exist.

If you need to read or write Byline content from your own code today (a public frontend, a script, a seed), the supported door is the in-process [Client SDK](./01-client-sdk.md), not an HTTP endpoint.

## Byline-owned host route mounts

Hosts configure Byline-owned URL paths through `BaseConfig.routes`. Inputs are
partial. `defineClientConfig()` and `defineServerConfig()` resolve and validate
them when configuration is registered, before replacing the registered config:

```ts
import {
  defineClientConfig,
  type ClientConfig,
  type RoutesConfigInput,
} from '@byline/core'

const routes: RoutesConfigInput = {
  admin: '/internal/cms',
  api: '/services/content',
  signIn: '/staff/login',
}

export function registerClientConfig(config: ClientConfig) {
  const registered = defineClientConfig({ ...config, routes })
  return registered.routes // frozen canonical { admin, api, signIn }
}
```

| Key | Default | Contract |
|---|---|---|
| `admin` | `/admin` | One or more segments; mounts the admin route tree. |
| `api` | `/api` | One or more segments; reserved for a future public API. |
| `signIn` | `/sign-in` | One or more segments, outside the admin and API trees. |

Resolution trims surrounding whitespace, adds the leading slash, removes
duplicate and trailing slashes, and uses defaults for blank or omitted values.
Query strings, hashes, percent-encoded paths, colons, backslashes, embedded
whitespace, control characters, and `.` / `..` segments are rejected. Admin and
API trees may not overlap in either direction, and the configured sign-in path
must be outside both trees. Core supports safe multi-segment admin and API paths;
the CLI additionally requires every generated filename segment to match
`[a-z][a-z0-9-]*` and applies locale, system-route, and TanStack filename checks.

The resolved `RoutesConfig` properties are `readonly`, and the resolved object is
frozen. Registration therefore takes a snapshot that cannot be changed by
mutating the input or the exposed route object. Route helpers and request/render
consumers read these already-resolved values; they do not defer route-config
normalization or validation until a render or request. A standalone client-safe
facade can call `resolveRoutes()` once at module registration, as the generated
`byline/routes.ts` does, and pass that resolved object to both configs.

:::warning[Config does not register file routes]
Changing `routes.admin` or `routes.signIn` does not move TanStack route files. The
filesystem location and each route factory's `createFileRoute` ID must match the
configured mount. The CLI keeps `byline/routes.ts`, `src/routes/_byline/...`, and
the factory IDs aligned; TanStack regenerates `src/routeTree.gen.ts`, which must
not be edited by hand.
:::

The TanStack host exports configuration-aware helpers from
`@byline/host-tanstack-start/routes`:

- `getAdminRoutePath(...)` builds dashboard and child URLs.
- `getAdminRouteId(...)` builds matching `/_byline/...` route IDs.
- `isRoutePathWithin(...)` and `isAdminRoutePathActive(...)` perform
  segment-delimited active-route checks.
- `getSignInRoutePath()` resolves the sign-in destination.
- `resolveAdminCallbackPath(...)` accepts a safe post-auth callback only when
  its pathname remains inside the configured admin subtree.
- `resolveAdminSignInRedirect(...)` applies that restriction and otherwise
  falls back to the configured admin dashboard.

The built-in shell uses these for menus, breadcrumbs, sort/pager navigation,
create/edit/history links, post-delete navigation, route context, and sign-out.
Custom admin components should use the same helpers rather than concatenate
`/admin`. Public host code should instead import the client-safe route data from
its `byline/public.ts` facade; the generated facade already exposes resolved,
frozen route data.

The callback helpers build on `normalizeRootRelativeRedirect()` from
`@byline/core`, the shared framework-independent primitive used at redirect
sinks. It accepts only same-origin, root-relative destinations, canonicalizes
safe query/hash text through the URL parser, and rejects absolute or
protocol-relative URLs, backslashes, unsafe control code points, encoded path
data, and `.` / `..` traversal segments. The TanStack host then adds the stricter
admin-subtree check: a valid root-relative public path is still not a valid admin
post-sign-in callback.

`routes.api` is currently a reservation used for collision checks and host locale
rewriting. Setting it does **not** mount an HTTP API; the no-public-API boundary
described below remains unchanged.

The architecture is four layers, top to bottom:

```
┌──────────────────────────────────────────────────────────────────┐
│ Admin UI (React + TanStack Router)                               │
│   apps/webapp/src/routes/_byline/...                            │
└──────────────────────────────────────────────────────────────────┘
                              │  invokes via @tanstack/react-start
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Server functions (transport layer)                               │
│   packages/host-tanstack-start/src/server-fns/<area>/<verb>.ts   │
│     - createServerFn({ method: 'GET' | 'POST' })                 │
│     - validator(...)                                        │
│     - resolves RequestContext via getAdminRequestContext()       │
│     - serialises the result                                      │
└──────────────────────────────────────────────────────────────────┘
                              │  delegates to
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Core services (business logic, framework-agnostic)               │
│   packages/core/src/services/                                    │
│     - document-lifecycle/   (create / update / status / delete)  │
│     - field-upload.ts       (validate / store / hooks / variants)│
│     - document-read.ts      (afterRead orchestration)            │
│     - populate.ts           (relation expansion)                 │
│   packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts │
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

Per-collection document operations against the universal storage layer. All of these route through the `document-lifecycle/` services (writes) or the `@byline/client` `CollectionHandle` (reads) and pass through the `assertActorCanPerform` ability check before touching storage.

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
| `upload.ts`   | `POST` | Field-level file upload; full pipeline documented in [File / Media Uploads](../04-collections/05-file-media-uploads.md). |
| `utils.ts`    | —      | `serialise()` helpers shared across the above.                                                   |

### `auth/` — sign-in / sign-out / session

| File              | Verb   | Purpose                                                          |
|-------------------|--------|------------------------------------------------------------------|
| `sign-in.ts`      | `POST` | Password + JWT issue via `JwtSessionProvider`.                   |
| `sign-out.ts`     | `POST` | Revoke refresh token, clear cookies.                             |
| `current-user.ts` | `GET`  | Resolve and return the current `AdminAuth` actor for the route.  |

### `admin-users/`, `admin-roles/`, `admin-permissions/`, `admin-account/`

Administrative management of the auth subsystem. Each handler delegates to the matching command in `packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts` and is gated by `assertAdminActor` inside the command — so the transport wrappers themselves carry no policy.

| Area                | Files                                                                                       |
|---------------------|---------------------------------------------------------------------------------------------|
| `admin-users/`      | `create`, `update`, `delete`, `enable`, `disable`, `get`, `list`, `set-password`, `set-user-roles`, `get-user-roles` |
| `admin-roles/`      | `create`, `update`, `delete`, `get`, `list`, `reorder`                                      |
| `admin-permissions/`| `list-registered`, `get-role-abilities`, `set-role-abilities`, `who-has`                    |
| `admin-account/`    | `get`, `update`, `change-password`                                                         |

(See `packages/host-tanstack-start/src/server-fns/admin-*/` for the canonical file list.)

## Anatomy of a server function

A representative handler — `collections/get.ts`:

```ts
const getDocumentFn = createServerFn({ method: 'GET' })
  .validator((input: { collection: string; id: string; locale?: string; depth?: number }) => input)
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
  .validator(parseCreateInput)
  .handler(async ({ data }) => {
    const lifecycleCtx = {
      db, definition, collectionId, ...,
      requestContext: await getAdminRequestContext(),
    }
    const result = await createDocument(lifecycleCtx, { data: data.fields, locale })
    return serialise(result)
  })
```

The `requestContext` is what `assertActorCanPerform` reads inside the `document-lifecycle/` services — the gate runs in the service, not in the transport. That keeps the policy enforcement on the same side of the wire as the business logic, so any future stable HTTP transport inherits the gate for free.

## The `@byline/client` indirection

Read paths in the admin webapp do not call the database adapter directly. They go through `@byline/client` (`CollectionHandle`) — the same in-process SDK a non-admin reader would use. This is intentional: it means admin reads exercise the same `beforeRead` hooks, the same `afterRead` shaping, and the same populate orchestration as future external clients. The transport layer is the only thing that changes when a stable HTTP boundary lands.

Writes go straight to the `document-lifecycle/` services. The client's write surface (`create` / `update` / `delete` / `changeStatus`) wraps the same lifecycle functions, so a future stable HTTP endpoint can be a thin shim around either path with no business-logic changes.

## What Byline deliberately does not have

There is **no stable, public, framework-agnostic HTTP API contract today** for any of these operations. Specifically:

- No `/api/<collection>` REST routes.
- No GraphQL endpoint.
- No OpenAPI / Swagger surface.
- No SDKs published for external use beyond the in-process `@byline/client`.

Everything goes through TanStack Start's server-function transport, which is conceptually closer to RPC than HTTP — the wire shape is an implementation detail of TanStack Start, not a contract Byline owns.

One adjacent surface ships today without being an API: the **markdown representations** of published documents — `.md` at every canonical URL, plus the `llms.txt` index (see [Markdown Export](./04-markdown-export.md)). These are app-owned, read-only representations with the same standing as the HTML pages and `sitemap.xml`, not a transport boundary, and they don't change the trigger calculus below. They do partially answer "where's the public API?" for the nearest-term external consumers — AI agents — which read the `.md` surface without any stable HTTP contract existing.

Introducing a stable HTTP transport now for just one operation (uploads, say, or `findById`) would create a misleading partial boundary: that operation would have a public transport shape while everything around it stayed internal RPC. The split would force a later redesign once the first external client appeared.

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
| Admin UI routes                          | `apps/webapp/src/routes/_byline/<configured-admin-path>/` (the repository example uses `admin`) |
| Document server fns (current transport)  | `packages/host-tanstack-start/src/server-fns/collections/`                |
| Auth server fns                          | `packages/host-tanstack-start/src/server-fns/auth/`                       |
| Admin-management server fns              | `packages/host-tanstack-start/src/server-fns/admin-{users,roles,permissions,account}/` |
| Auth context resolver                    | `packages/host-tanstack-start/src/auth/auth-context.ts` (`getAdminRequestContext`) |
| Route config / canonicalization           | `packages/core/src/config/routes.ts`                                      |
| Shared root-relative redirect validation  | `packages/core/src/utils/root-relative-redirect.ts`                       |
| Admin and sign-in path helpers            | `packages/host-tanstack-start/src/routes/{admin-path,sign-in-path}.ts`     |
| App-owned client-safe route data           | `apps/webapp/byline/routes.ts`, re-exported by `byline/public.ts`          |
| Document write services                  | `packages/core/src/services/document-lifecycle/` (per-operation modules)  |
| Field-level upload service               | `packages/core/src/services/field-upload.ts`                              |
| Document read services + hooks           | `packages/core/src/services/document-read.ts` + `populate.ts`             |
| Auth gates                               | `packages/core/src/auth/assert-actor-can-perform.ts`, `packages/admin/src/lib/assert-admin-actor.ts` |
| Admin-management commands                | `packages/admin/src/modules/admin-{users,roles,permissions,account}/commands.ts` |
| In-process client (used by admin reads)  | `packages/client/src/` + `packages/host-tanstack-start/src/integrations/byline-client.ts` |
