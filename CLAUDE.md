# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Note: See docs/analysis/STORAGE-ANALYSIS.md for ongoing work on the storage system.

## Project Overview

Byline CMS — an open-source, AI-first headless CMS. Currently a prototype/PoC. Licensed MPL-2.0.

## Monorepo Structure

**pnpm + Turborepo** monorepo. Workspaces: `packages/*` and `apps/*`.

| Package | Import alias | Purpose |
|---|---|---|
| `apps/webapp` | `@byline/webapp` | TanStack Start (SSR mode) + React admin UI. Vite dev server on `:5173`, API on `:3001` |
| `packages/core` | `@byline/core` | Types, config, patch logic, workflow, Zod schema builder |
| `packages/client` | `@byline/client` | In-process SDK over the storage primitives + `document-lifecycle` (find / create / update / delete / populate / status-aware reads) |
| `packages/auth` | `@byline/auth` | Actor primitives, `RequestContext`, `AbilityRegistry`, `SessionProvider` interface, error factories. Leaf package |
| `packages/admin` | `@byline/admin` | Admin subsystem — users, roles, permissions, account modules, plus the built-in JWT session provider |
| `packages/db-postgres` | `@byline/db-postgres` | Postgres adapter (Drizzle ORM); subpath `@byline/db-postgres/admin` carries the admin-store repositories |
| `packages/db-remote` | `@byline/db-remote` | Remote/stub adapter (placeholder) |
| `packages/db-mysql` | `@byline/db-mysql` | MySQL adapter (placeholder) |
| `packages/storage-local` | `@byline/storage-local` | Local filesystem storage provider |
| `packages/storage-s3` | `@byline/storage-s3` | S3-compatible storage provider |
| `packages/ui` | `@byline/ui` | Shared UI components (Rslib build) |

Internal packages use `@byline/*` imports. The webapp uses `@/` alias for `apps/webapp/src`.

## Commands

```sh
pnpm dev              # Start all (UI + API), parallel via Turbo
pnpm build            # Build all packages and apps
pnpm lint             # Biome check (lint + format). No ESLint/Prettier.
pnpm typecheck        # TypeScript type checking across workspace
pnpm test             # Run all tests via Turbo
pnpm clean            # Clean all workspaces + root node_modules
```

### Per-package testing

```sh
cd packages/core && pnpm test              # Vitest (node mode)
cd packages/core && pnpm test:watch        # Vitest watch mode
cd apps/webapp && pnpm test                # Vitest (jsdom mode)
cd packages/db-postgres && pnpm test       # tsx --test (requires running Postgres)
```

To run a single test file in the webapp: `cd apps/webapp && pnpm vitest run --mode=jsdom <file>`

### Database (Postgres via Docker)

```sh
cd postgres && ./postgres.sh up -d         # Start Postgres (detached)
cd postgres && ./postgres.sh down          # Stop and remove container
cd packages/db-postgres/src/database && ./db_init.sh   # Initialize DB
pnpm drizzle:generate                      # Generate Drizzle migrations
pnpm drizzle:migrate                       # Apply migrations
cd apps/webapp && pnpm tsx --env-file=.env byline/seed.ts  # Seed categories + docs
```

Env files: `apps/webapp/.env` and `packages/db-postgres/.env` (copy from `.env.example`).

## Code Style

- **Biome** for linting and formatting. Run `pnpm lint` to auto-fix. Never introduce ESLint or Prettier.
- Biome config: 2-space indent, single quotes, LF line endings, 100-char line width, trailing commas (ES5), no semicolons.
- Import ordering is enforced by Biome: Node builtins → URLs → React → TanStack → packages → local (with blank line separators).

## Architecture

### Universal Storage (EAV-per-type)

Documents are stored in typed `store_*` tables (`store_text`, `store_numeric`, `store_boolean`, `store_datetime`, `store_json`, `store_file`, `store_relation`) plus `store_meta` for stable block/array-item identities. A custom path notation (e.g. `content.1.photoBlock.0.display`) addresses each value.

- **Flatten** (write): `packages/db-postgres/src/modules/storage/storage-utils.ts` → `flattenFieldSetData()`
- **Reconstruct** (read): `packages/db-postgres/src/modules/storage/storage-utils.ts` → `restoreFieldSetData()` — schema-aware, handles meta rows (`_id`, `_type`), locale resolution, and type-correct value extraction inline
- **Store manifest**: `packages/db-postgres/src/modules/storage/storage-store-manifest.ts` — declarative column manifest generates per-store SELECT lists for the UNION ALL. Adding a column is a one-line change; positional mismatches are structurally impossible. The adapter-agnostic `fieldTypeToStore` / `fieldTypeToStoreType` mappings live in `@byline/core` (see "Field → Store Mapping" below) and are re-exported here for adapter-internal use.
- **Selective field loading**: For list views, `resolveStoreTypes()` determines which store tables are needed for the requested fields, builds a partial UNION ALL (skipping irrelevant tables), and trims the reconstructed output to only the requested fields. Driven by `CollectionAdminConfig.columns`.
- Block/array items carry a stable `_id` (UUIDv7) in `store_meta` for identity tracking. The `_id` is synthetic metadata — **never persist it via `flattenFieldSetData`**, never treat it as a data key in renderers.

### Immutable Versioning

Document versions saved by default (UUIDv7 time-ordered). `ROW_NUMBER() OVER PARTITION` resolves "current" version via the `current_documents` DB view. Status changes mutate the existing version row in-place (status is lifecycle metadata, not content).

### Patch-Based Updates

Client accumulates `DocumentPatch[]` and POSTs `{ data, patches }`. Server applies via `applyPatches` (`packages/core/src/patches/`). Three patch families: `field.*`, `array.*`, `block.*`. Foundation for future collaborative editing (OT/CRDT).

### Schema / Presentation Split

`CollectionDefinition` (schema, server-safe data) is separate from `CollectionAdminConfig` (UI config via `defineAdmin()`). Mirrors Django's model vs ModelAdmin pattern. Collection definitions live in `apps/webapp/byline/collections/`.

### Workflow System

- Types and `defineWorkflow()` in `packages/core/src/@types/collection-types.ts`
- Logic in `packages/core/src/workflow/workflow.ts` — transition validation is ±1 step or reset-to-first
- Subpath export: `@byline/core/workflow`
- API route: `PATCH /admin/api/$collection/$id/status`
- Zod schema builder derives `status` enum dynamically from workflow config

### Registry / Dependency Injection

A typed `Registry`/`AsyncRegistry` DI container in `packages/core/src/lib/registry.ts` provides compile-time dependency graph validation. The server-side entry point `initBylineCore()` (`packages/core/src/core.ts`) composes config, collections, DB adapter, and storage provider into a `BylineCore` instance.

### Config Loading

- Browser: `apps/webapp/src/client.tsx` imports `../byline.client.config.ts`
- Server: `apps/webapp/byline.server.config.ts` calls `initBylineCore()` with the full `ServerConfig`

### Auth (`@byline/auth` + `@byline/admin`)

The auth subsystem is split across two packages:

- `@byline/auth` — leaf package with the actor primitives (`AdminAuth`, `UserAuth`, `Actor`), the `RequestContext` shape (extends the seed of `ReadContext`), the `AbilityRegistry`, the `SessionProvider` interface, and the `AuthError` factories. No DB, no transport — types and small classes only.
- `@byline/admin` — concrete implementation: admin user / role / permission / account modules (each as `commands.ts` + `repository.ts` + `service.ts` + `dto.ts` + `schemas.ts` + `errors.ts` + `abilities.ts`), the built-in `JwtSessionProvider`, password hashing (argon2id), and the `AdminStore` aggregate. `@byline/db-postgres/admin` ships the Postgres-backed repositories plugged into `AdminStore`.

Admin-area transport for the webapp lives in `apps/webapp/src/modules/admin/{admin-users,admin-roles,admin-permissions,auth}/*` — each file is a thin `createServerFn` wrapper that resolves a `RequestContext` via `getAdminRequestContext()` (`apps/webapp/src/lib/auth-context.ts`), then delegates to the matching `*Command` from `@byline/admin/*`. The wrappers are intentionally boilerplate-shaped today; consolidation is deferred until service-layer enforcement (below) settles per-fn variation.

**Service-layer enforcement is live**, split across two helpers by realm:

- **Document collections** — `assertActorCanPerform` (`packages/core/src/auth/assert-actor-can-perform.ts`). Called by every write path (`document-lifecycle.*`, `document-upload`) before any storage work, by `@byline/client` `CollectionHandle` for read paths, and by every admin webapp *document-collection* server fn under `apps/webapp/src/modules/admin/collections/*` (`list`, `get`, `history`, `stats` for reads; `create`, `update`, `delete`, `status`, `upload` for writes). Policy: no-context → `ERR_UNAUTHENTICATED`; `actor: null` → permitted only on `read` with `readMode === 'published'`; otherwise `actor.assertAbility('collections.<path>.<verb>')`.
- **Admin user / role / permission management** — `assertAdminActor` (`packages/admin/src/lib/assert-admin-actor.ts`). Called inside every `*Command` in `@byline/admin/admin-{users,roles,permissions}`. Always requires a present `AdminAuth` actor (no public path) and asserts the specific module ability (`admin.users.*`, `admin.roles.*`, `admin.permissions.*`).

Direct `db.commands.*` / `db.queries.*` calls intentionally bypass both helpers — the documented escape hatch for seeds, migrations, and internal tooling. The `_bypassBeforeRead: true` option on `@byline/client` read methods is the matching escape hatch on the read side.

**Read-side row-scoping via `beforeRead` (shipped)** — `CollectionHooks.beforeRead` fires once per `findDocuments` call and once per populate batch (per target collection). Returns a `QueryPredicate` (the same shape as the client's `where` clause, with `$and` / `$or` combinators) that is AND-merged with the caller's `where` and compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL machinery. Async-capable; cached on `ReadContext.beforeReadCache` so async hooks don't re-run across populate fanout. Wired into every `CollectionHandle` read entry point (`find`, `findById`, `findByPath`, `findOne`, `countByStatus`, `history`, `findByVersion`) and into `populateDocuments`. The admin webapp's document-collection reads now flow through `CollectionHandle` (the public `ClientDocument` shape — see `apps/webapp/src/lib/byline-client.ts`) so admin code paths inherit the same pipeline. Six worked recipes (owner-only drafts, multi-tenant scoping, embargo, soft-delete hide, department visibility, self-only) live in [`docs/analysis/ACCESS-CONTROL-RECIPES.md`](docs/analysis/ACCESS-CONTROL-RECIPES.md). See [`docs/analysis/AUTHN-AUTHZ-ANALYSIS.md`](docs/analysis/AUTHN-AUTHZ-ANALYSIS.md) for the full Phase status table — only outstanding auth track is the bulk of Phase 8 (registered-collections / who-has-what inspector views).

### Routing & API

- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/webapp/src/routes`, generates `src/routeTree.gen.ts`
- **Current transport phase**: the app currently exposes **no stable/public HTTP API transport** for document or upload operations. The only client today is the admin UI, so collection operations are intentionally handled through TanStack Start server functions under `apps/webapp/src/modules/admin/collections` rather than through framework-agnostic HTTP endpoints.
- **Deferred stable HTTP boundary**: stable HTTP endpoints for uploads, reads, creates, and updates are intentionally deferred until the first non-admin client arrives (for example mobile, desktop, or another remote consumer). At that point the transport boundary should be designed across the full surface area, not just uploads. See `docs/analysis/ROUTING-API-ANALYSIS.md`.
- **Validation**: Zod via schema builder in `packages/core/src/schemas/zod/builder.ts`

### Client API (`@byline/client`)

A higher-level, DSL-like API for querying documents from outside the admin UI. Sits above the storage primitives (`IDbAdapter`) and the `document-lifecycle` service. See `packages/client/DESIGN.md` for the full design and phase breakdown.

- **Two-layer architecture**: Storage primitives handle direct DB operations; the client API owns query DSL translation, response shaping, relationship population, and (planned) access control.
- **Patches stay admin-internal**: The patch system (`field.*`, `array.*`, `block.*`) is tied to UI intent (reordering, block insertion). The client API does whole-document or field-level writes via `createDocumentVersion()`.
- **Phase 1 — read path (shipped)**: `find()`, `findOne()`, `findById()`, `findByPath()`, `count()`. Results are camelCase-shaped through `shapeDocument()`. `ClientDocument<F>` is generic so callers can narrow the `fields` shape per-collection.
- **Phase 2 — field-level filters and sorting (shipped)**: `where`/`sort` on collection field values compile to EXISTS subqueries + `LEFT JOIN LATERAL` against the EAV store tables via `IDocumentQueries.findDocuments()`. `CollectionHandle.find()` routes all queries through this path.
- **Phase 3 — relationship population (shipped)**: `populate` + `depth` for `store_relation` targets, orchestrated by `populateDocuments()` in `packages/core/src/services/populate.ts`. Batches by depth level per target collection via `IDocumentQueries.getDocumentsByDocumentIds()`. Two-axis DSL (`true` / `'*'` / `PopulateMap`), unified relation envelope across populated/unresolved/cycle states, and a request-scoped `ReadContext` shared with the `afterRead` hook to foreclose A→B→A recursion. Consumed by both `@byline/client` and the admin API preview route. See `docs/analysis/RELATIONSHIPS-ANALYSIS.md`.
- **Phase 4 — write path (shipped)**: `create()`, `update()`, `delete()`, `changeStatus()`, `unpublish()` on `CollectionHandle` delegating to `document-lifecycle` functions (`packages/core/src/services/document-lifecycle.ts`). Each method resolves the collection id once, builds a `DocumentLifecycleContext`, and invokes the corresponding service — collection hooks (`beforeCreate`, `afterUpdate`, etc.) fire the same way the admin server fns do. The client resolves a logger in priority order: explicit `config.logger` → `getLogger()` if `initBylineCore()` has registered one → silent no-op, so migration scripts and tests work without setup. Patches stay admin-internal; public writes are whole-document.
- **Phase 5 — status-aware reads (shipped)**: `status?: 'published' | 'any'` on `FindOptions` / `FindOneOptions` / `FindByIdOptions` / `FindByPathOptions`. `@byline/client` defaults to `'published'` (safe for public readers); admin code paths call the adapter directly without a mode and the adapter defaults to `'any'`. Backed by a new `current_published_documents` Postgres view that applies `ROW_NUMBER() PARTITION BY document_id` on rows filtered to `status = 'published'` — so a document with a newer draft over a previously-published version keeps returning the published content until the draft itself is published. Threaded through `populateDocuments` as `readMode` so populated relation targets follow the same rule.
- **`afterRead` collection hook (shipped)**: `CollectionHooks.afterRead` fires once per materialised document on every `@byline/client` read path and once per populated relation target. The hook receives `{ doc, collectionPath, readContext }` — `doc` is the raw storage shape, mutable; mutations to `doc.fields` propagate into the shaped response. Fires **after** populate on the source document, so hooks observe the fully populated tree. `ReadContext` now carries an `afterReadFired` set that enforces "each document runs through `afterRead` at most once per logical request" — the A→B→A guard. Hooks that perform their own reads thread `readContext` back in via `client.collection(…).findById(id, { _readContext: readContext })`. See `packages/core/src/services/document-read.ts`.
- **`beforeRead` collection hook (shipped)**: `CollectionHooks.beforeRead` fires once per `findDocuments` call (and once per populate batch, per target collection), **before** any DB work. Receives `{ collectionPath, requestContext, readContext }` and returns a `QueryPredicate` (or `void` for no scoping) that is AND-merged with the caller's `where` and compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL machinery the client's existing `where` parser emits. The predicate language adds `$and` / `$or` combinators to the `where` shape; `status` / `path` inside a combinator downshift to a direct outer-scope column comparison via `DocumentColumnFilter`. Per-`ReadContext` cache (`beforeReadCache`) ensures async hooks run once per collection per request. `_bypassBeforeRead: true` on read options is the escape hatch for admin tooling, seeds, and migrations. See `packages/core/src/auth/apply-before-read.ts`, `packages/core/src/query/parse-where.ts`, and the worked recipes in [`docs/analysis/ACCESS-CONTROL-RECIPES.md`](docs/analysis/ACCESS-CONTROL-RECIPES.md).

### Field → Store Mapping

The single source of truth for collection-field-type → EAV store table + value column lives in `packages/core/src/storage/field-store-map.ts`. Both `@byline/client` (where-clause parsing) and `@byline/db-postgres` (UNION ALL + filter SQL generation) consume it. A contract test (`field-store-map.test.node.ts`) enumerates every declared field type to prevent drift.

### Collections → Forms → Patches → Storage

- Form state + patch accumulation: `apps/webapp/src/ui/fields/form-context.tsx`
- Form layout/validation: `apps/webapp/src/ui/fields/form-renderer.tsx`
- Field widgets emit patches: `apps/webapp/src/ui/fields/field-renderer.tsx`
- DB schema: `packages/db-postgres/src/database/schema/index.ts`; migrations in `packages/db-postgres/src/database/migrations`
