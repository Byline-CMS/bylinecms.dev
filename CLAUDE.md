# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Note: See docs/03-architecture/01-document-storage.md for the present-state reference of the storage system.

## Project Overview

Byline CMS — an open-source, AI-first headless CMS. Currently at a stable v4.x release (lockstep across the publishable `@byline/*` packages). Licensed MPL-2.0.

## Monorepo Structure

**pnpm + Turborepo** monorepo. Workspaces: `packages/*` and `apps/*`.

| Package | Import alias | Purpose |
|---|---|---|
| `apps/webapp` | `@byline/webapp` | TanStack Start (SSR mode) + React admin UI. Vite dev server on `:5173`, API on `:3001` |
| `packages/core` | `@byline/core` | Types, config, patch logic, workflow, Zod schema builder |
| `packages/client` | `@byline/client` | In-process SDK over the storage primitives + `document-lifecycle` (find / create / update / delete / populate / status-aware reads). `@byline/client/server` carries the request-bound client getters (`getAdmin/getPublic/getSystem/getViewerBylineClient`, `isPreviewActive`) and the session/preview cookie + `getAdminRequestContext` machinery, implemented over core's `HostRequestBridge` seam; the root exports the `Register` interface the app's generated types merge into |
| `packages/generated-types` | `@byline/generated-types` | Empty declaration-merge target: each app's generated collection types declare into it, so apps import their own types as `import type { NewsFields } from '@byline/generated-types'` (type-only; one augmenting app per TS program) |
| `packages/auth` | `@byline/auth` | Actor primitives, `RequestContext`, `AbilityRegistry`, `SessionProvider` interface, error factories. Leaf package |
| `packages/admin` | `@byline/admin` | Admin subsystem — admin user / role / permission / account modules, the built-in JWT session provider, **and** the document-editor React surface: `forms/` (FormRenderer, form-context, document-actions, path-widget, navigation-guard), `fields/` (FieldRenderer + every per-type widget + field-side services Context), `presentation/` (AdminGroup, AdminRow, AdminTabs), `widgets/` (StatusBadge, DiffModal). Single React barrel at `@byline/admin/react`. |
| `packages/host-tanstack-start` | `@byline/host-tanstack-start` | TanStack Start host adapter — server fns, auth context, integration glue (`byline-client`, `byline-core`, `byline-admin-services`, `byline-field-services`), admin shell, route factories, and the i18n host integration (`src/i18n/*` cookie + locale-cascade + server translator) |
| `packages/db-postgres` | `@byline/db-postgres` | Postgres adapter (Drizzle ORM); subpath `@byline/db-postgres/admin` carries the admin-store repositories |
| `packages/storage-local` | `@byline/storage-local` | Local filesystem storage provider |
| `packages/storage-s3` | `@byline/storage-s3` | S3-compatible storage provider |
| `packages/ui` | `@byline/ui` | Framework-agnostic React primitives — Button, Input, Modal, Drawer, Table, Alert, icons, datepicker, generic `DraggableSortable`. No CMS concepts; importable independent of admin. Single barrel at `@byline/ui/react`. |
| `packages/i18n` | `@byline/i18n` | Admin-interface translation system — `TranslationBundle` types, `mergeTranslations`, ICU formatter, locale resolution. React surface (`I18nProvider`, `useTranslation`, `LanguageMenu`) at `@byline/i18n/react`. Built-in `byline-admin` bundle (EN/FR) + `adminTranslations({ locales })` factory at `@byline/i18n/admin`. |
| `packages/richtext-lexical` | `@byline/richtext-lexical` | Lexical-based richtext editor adapter |
| `packages/search-postgres` | `@byline/search-postgres` | Built-in Postgres full-text `SearchProvider` driver — weighted `tsvector` index; owns its own schema (numbered SQL migrations); reuses the host pg pool. See "Search & Retrieval" below |
| `packages/ai` | `@byline/ai` | AI subsystem — provider-agnostic execution (OpenAI / Google / Anthropic) for `executeInstruction`, `generateStructured`, and Lexical-node `patch` (streaming + non-streaming). Browser-safe root entry; SDK-backed execution behind `@byline/ai/server`; editor plugins at `@byline/ai/plugins/{text,lexical}`. See `packages/ai/README.md` |
| `packages/cli` | `@byline/cli` | Guided installer that adds Byline to an existing TanStack Start app (`byline init`, `doctor`, …) |

Internal packages use `@byline/*` imports. The webapp uses `@/` alias for `apps/webapp/src`.

## Commands

```sh
pnpm dev              # Start all (UI + API), parallel via Turbo
pnpm build            # Build all packages and apps
pnpm lint             # Biome check (lint + format). No ESLint/Prettier.
pnpm typecheck        # TypeScript type checking across workspace
pnpm test             # Unit tests — no Postgres required
pnpm test:integration # Integration suite — requires byline_test (see docs/09-testing.md)
pnpm clean            # Clean all workspaces + root node_modules
```

`pnpm test:integration` requires a one-time `pnpm db:init:test` to create the `byline_test` database. The runner auto-migrates it on startup and truncates between test files. CI runs the same suite via `.github/workflows/ci.yml` against a Postgres service container. See [docs/09-testing.md](docs/09-testing.md) for the full story (safety guards, isolation strategy, single-test invocation).

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
cd apps/webapp && pnpm tsx byline/seed.ts  # Seed categories + docs (byline/load-env.ts loads .env.local + .env)
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

Document versions saved by default (UUIDv7 time-ordered). `ROW_NUMBER() OVER PARTITION` resolves "current" version via the `current_documents` DB view. Status changes mutate the existing version row in-place (status is lifecycle metadata, not content). Document-grain system fields (`path`, editorial `availableLocales`) are likewise written outside the version stream — the admin edits them via dedicated non-versioned commands (`updateDocumentPath`, `setDocumentAvailableLocales`) that mint no version and don't reset status. See docs/04-collections/05-document-paths.md and docs/07-internationalization/index.md.

### Patch-Based Updates

Client accumulates `DocumentPatch[]` and POSTs `{ data, patches }`. Server applies via `applyPatches` (`packages/core/src/patches/`). Three patch families: `field.*`, `array.*`, `block.*`. Foundation for future collaborative editing (OT/CRDT).

### Schema / Presentation Split

`CollectionDefinition` (schema, server-safe data) is separate from `CollectionAdminConfig` (UI config via `defineAdmin()`). Mirrors Django's model vs ModelAdmin pattern. Collection definitions live in `apps/webapp/byline/collections/`. Blocks follow the same split: React-free `defineBlock()` schemas paired with `defineBlockAdmin()` configs registered on `ClientConfig.blockAdmin` (blockType-keyed, applies wherever the block renders) — see docs/04-collections/02-blocks.md. Reference blocks live in `apps/webapp/byline/blocks/`.

### Workflow System

- Types and `defineWorkflow()` in `packages/core/src/@types/collection-types.ts`
- Logic in `packages/core/src/workflow/workflow.ts` — transition validation is ±1 step or reset-to-first
- Subpath export: `@byline/core/workflow`
- API route: `PATCH /admin/api/$collection/$id/status`
- Zod schema builder derives `status` enum dynamically from workflow config

### Registry / Dependency Injection

A typed `Registry`/`AsyncRegistry` DI container in `packages/core/src/lib/registry.ts` provides compile-time dependency graph validation. The server-side entry point `initBylineCore()` (`packages/core/src/core.ts`) composes config, collections, DB adapter, and storage provider into a `BylineCore` instance.

### Config Loading

- All Byline configuration lives under `apps/webapp/byline/`: `i18n.ts`, `routes.ts`, `admin.config.ts`, `server.config.ts`, plus `collections/`, `blocks/`, `fields/`, `seeds/`.
- Browser/SSR: the `_byline` route registers the client config via two complementary entry points that both import `byline/admin.config.ts` (and call `defineClientConfig` idempotently): its `beforeLoad` (`route.tsx`, a dynamic import) runs before any `_byline/*` child loader reads `getClientConfig()`, and its `route.lazy.tsx` side-effect import covers component render / initial hydration (where `beforeLoad` is not re-run). Both keep the admin/editor graph code-split out of public-route bundles. Needing both: a lazy *component* module can be outrun by child loaders (hence `beforeLoad`), but `beforeLoad` doesn't re-run on hydration (hence the lazy import). The goal of this code-splitting is to keep the admin area's JS/bundles from leaking into the host application's public surface; why it can't yet collapse to a single eager registration (and whether that's even possible) is documented in [docs/08-admin-ui/02-client-config-registration.md](docs/08-admin-ui/02-client-config-registration.md).
- Server entry: `apps/webapp/src/server.ts` side-effect imports `byline/server.config.ts`, which calls `initBylineCore()` with the full `ServerConfig` and registers it on the process global. Server-side callers retrieve the resolved core via `getBylineCore<AdminStore>()` from `@byline/core`.

### Auth (`@byline/auth` + `@byline/admin`)

The auth subsystem is split across two packages:

- `@byline/auth` — leaf package with the actor primitives (`AdminAuth`, `UserAuth`, `Actor`), the `RequestContext` shape (extends the seed of `ReadContext`), the `AbilityRegistry`, the `SessionProvider` interface, and the `AuthError` factories. No DB, no transport — types and small classes only.
- `@byline/admin` — concrete implementation: admin user / role / permission / account modules (each as `commands.ts` + `repository.ts` + `service.ts` + `dto.ts` + `schemas.ts` + `errors.ts` + `abilities.ts`), the built-in `JwtSessionProvider`, password hashing (argon2id), and the `AdminStore` aggregate. `@byline/db-postgres/admin` ships the Postgres-backed repositories plugged into `AdminStore`.

Admin-area transport lives in `@byline/host-tanstack-start` under `packages/host-tanstack-start/src/server-fns/{admin-users,admin-roles,admin-permissions,admin-account,auth}/*` — each file is a thin `createServerFn` wrapper that resolves a `RequestContext` via `getAdminRequestContext()` (`@byline/client/server`, `packages/client/src/server/admin-context.ts`), then delegates to the matching `*Command` from `@byline/admin/*`. The wrappers are intentionally boilerplate-shaped today; consolidation is deferred until service-layer enforcement (below) settles per-fn variation.

**Service-layer enforcement is live**, split across two helpers by realm:

- **Document collections** — `assertActorCanPerform` (`packages/core/src/auth/assert-actor-can-perform.ts`). Called by every write path (`document-lifecycle.*`, `field-upload`) before any storage work, by `@byline/client` `CollectionHandle` for read paths, and by every host-adapter *document-collection* server fn under `packages/host-tanstack-start/src/server-fns/collections/*` (`list`, `get`, `history`, `stats` for reads; `create`, `update`, `delete`, `status`, `upload`, `restore-version`, `duplicate`, `copy-to-locale` for writes). Policy: no-context → `ERR_UNAUTHENTICATED`; `actor: null` → permitted only on `read` with `readMode === 'published'`; otherwise `actor.assertAbility('collections.<path>.<verb>')`.
- **Admin user / role / permission management** — `assertAdminActor` (`packages/admin/src/lib/assert-admin-actor.ts`). Called inside every `*Command` in `@byline/admin/admin-{users,roles,permissions}`. Always requires a present `AdminAuth` actor (no public path) and asserts the specific module ability (`admin.users.*`, `admin.roles.*`, `admin.permissions.*`).

Direct `db.commands.*` / `db.queries.*` calls intentionally bypass both helpers — the documented escape hatch for seeds, migrations, and internal tooling. The `_bypassBeforeRead: true` option on `@byline/client` read methods is the matching escape hatch on the read side.

**Read-side row-scoping via `beforeRead` (shipped)** — `CollectionHooks.beforeRead` fires once per `findDocuments` call and once per populate batch (per target collection). Returns a `QueryPredicate` (the same shape as the client's `where` clause, with `$and` / `$or` combinators) that is AND-merged with the caller's `where` and compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL machinery. Async-capable; cached on `ReadContext.beforeReadCache` so async hooks don't re-run across populate fanout. Wired into every `CollectionHandle` read entry point (`find`, `findById`, `findByPath`, `findOne`, `countByStatus`, `history`, `findByVersion`) and into `populateDocuments`. The host adapter's document-collection reads flow through `CollectionHandle` (the public `ClientDocument` shape — via the `@byline/client/server` getters in `packages/client/src/server/clients.ts`) so admin code paths inherit the same pipeline. Six worked recipes (owner-only drafts, multi-tenant scoping, embargo, soft-delete hide, department visibility, self-only) live in the [`docs/06-auth-and-security/01-authn-authz.md`](docs/06-auth-and-security/01-authn-authz.md) Quick Reference, alongside the full present-state reference of the auth subsystem.

### Routing & API

- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/webapp/src/routes`, generates `src/routeTree.gen.ts`
- **Current transport phase**: the app currently exposes **no stable/public HTTP API transport** for document or upload operations. The only client today is the admin UI, so collection operations are intentionally handled through TanStack Start server functions under `packages/host-tanstack-start/src/server-fns/collections/*` rather than through framework-agnostic HTTP endpoints.
- **Deferred stable HTTP boundary**: stable HTTP endpoints for uploads, reads, creates, and updates are intentionally deferred until the first non-admin client arrives (for example mobile, desktop, or another remote consumer). At that point the transport boundary should be designed across the full surface area, not just uploads. See `docs/05-reading-and-delivery/02-routing-and-api.md`.
- **Validation**: Zod via schema builder in `packages/core/src/schemas/zod/builder.ts`

### Client API (`@byline/client`)

A higher-level, DSL-like API for querying documents from outside the admin UI. Sits above the storage primitives (`IDbAdapter`) and the `document-lifecycle` service. See `packages/client/DESIGN.md` for the full design and phase breakdown.

- **Two-layer architecture**: Storage primitives handle direct DB operations; the client API owns query DSL translation, response shaping, relationship population, and (planned) access control.
- **Patches stay admin-internal**: The patch system (`field.*`, `array.*`, `block.*`) is tied to UI intent (reordering, block insertion). The client API does whole-document or field-level writes via `createDocumentVersion()`.
- **Phase 1 — read path (shipped)**: `find()`, `findOne()`, `findById()`, `findByPath()`, `count()`. Results are camelCase-shaped through `shapeDocument()`. `ClientDocument<F>` is generic so callers can narrow the `fields` shape per-collection.
- **Phase 2 — field-level filters and sorting (shipped)**: `where`/`sort` on collection field values compile to EXISTS subqueries + `LEFT JOIN LATERAL` against the EAV store tables via `IDocumentQueries.findDocuments()`. `CollectionHandle.find()` routes all queries through this path.
- **Phase 3 — relationship population (shipped)**: `populate` + `depth` for `store_relation` targets, orchestrated by `populateDocuments()` in `packages/core/src/services/populate.ts`. Batches by depth level per target collection via `IDocumentQueries.getDocumentsByDocumentIds()`. Two-axis DSL (`true` / `'*'` / `PopulateMap`), unified relation envelope across populated/unresolved/cycle states, and a request-scoped `ReadContext` shared with the `afterRead` hook to foreclose A→B→A recursion. Consumed by both `@byline/client` and the admin API preview route. See `docs/04-collections/03-relationships.md`.
- **Phase 4 — write path (shipped)**: `create()`, `update()`, `delete()`, `changeStatus()`, `unpublish()` on `CollectionHandle` delegating to `document-lifecycle` functions (`packages/core/src/services/document-lifecycle/`, per-operation modules). Each method resolves the collection id once, builds a `DocumentLifecycleContext`, and invokes the corresponding service — collection hooks (`beforeCreate`, `afterUpdate`, etc.) fire the same way the admin server fns do. The client resolves a logger in priority order: explicit `config.logger` → `getLogger()` if `initBylineCore()` has registered one → silent no-op, so migration scripts and tests work without setup. Patches stay admin-internal; public writes are whole-document.
- **Phase 5 — status-aware reads (shipped)**: `status?: 'published' | 'any'` on `FindOptions` / `FindOneOptions` / `FindByIdOptions` / `FindByPathOptions`. `@byline/client` defaults to `'published'` (safe for public readers); admin code paths call the adapter directly without a mode and the adapter defaults to `'any'`. Backed by a new `current_published_documents` Postgres view that applies `ROW_NUMBER() PARTITION BY document_id` on rows filtered to `status = 'published'` — so a document with a newer draft over a previously-published version keeps returning the published content until the draft itself is published. Threaded through `populateDocuments` as `readMode` so populated relation targets follow the same rule.
- **`afterRead` collection hook (shipped)**: `CollectionHooks.afterRead` fires once per materialised document on every `@byline/client` read path and once per populated relation target. The hook receives `{ doc, collectionPath, readContext }` — `doc` is the raw storage shape, mutable; mutations to `doc.fields` propagate into the shaped response. Fires **after** populate on the source document, so hooks observe the fully populated tree. `ReadContext` now carries an `afterReadFired` set that enforces "each document runs through `afterRead` at most once per logical request" — the A→B→A guard. Hooks that perform their own reads thread `readContext` back in via `client.collection(…).findById(id, { _readContext: readContext })`. See `packages/core/src/services/document-read.ts`.
- **`beforeRead` collection hook (shipped)**: `CollectionHooks.beforeRead` fires once per `findDocuments` call (and once per populate batch, per target collection), **before** any DB work. Receives `{ collectionPath, requestContext, readContext }` and returns a `QueryPredicate` (or `void` for no scoping) that is AND-merged with the caller's `where` and compiled into the same `EXISTS` / `LEFT JOIN LATERAL` SQL machinery the client's existing `where` parser emits. The predicate language adds `$and` / `$or` combinators to the `where` shape; `status` / `path` inside a combinator — or inside a nested relation sub-clause — downshift to a direct outer-scope column comparison via `DocumentColumnFilter` (the adapter wires `status` to `td${depth}.status` inside a relation hop and `path` to a `pathProjection` subquery against `byline_document_paths`, and `query` is dropped through that hop with a debug log). Per-`ReadContext` cache (`beforeReadCache`) ensures async hooks run once per collection per request. `_bypassBeforeRead: true` on read options is the escape hatch for admin tooling, seeds, and migrations. See `packages/core/src/auth/apply-before-read.ts`, `packages/core/src/query/parse-where.ts`, and the worked recipes in the [`docs/06-auth-and-security/01-authn-authz.md`](docs/06-auth-and-security/01-authn-authz.md) Quick Reference.

### Field → Store Mapping

The single source of truth for collection-field-type → EAV store table + value column lives in `packages/core/src/storage/field-store-map.ts`. Both `@byline/client` (where-clause parsing) and `@byline/db-postgres` (UNION ALL + filter SQL generation) consume it. A contract test (`field-store-map.test.node.ts`) enumerates every declared field type to prevent drift.

### Markdown export (agent surface)

One-way Lexical → markdown serialization (`lexicalToMarkdown`, `@byline/richtext-lexical/server`) registered through the editor-agnostic `ServerConfig.fields.richText.toMarkdown` seam; the schema-aware `documentToMarkdown` assembler in `packages/core/src/services/document-to-markdown.ts`; app-owned `.md` routes per content locale, `llms.txt`, and three advertisement channels (`.md` URLs, head `rel=alternate` links, `Accept: text/markdown` 302 negotiation) in `apps/webapp`. Published-only and read-only; the output format is a contract surface pinned by tests. See docs/05-reading-and-delivery/04-markdown-export.md.

### Search & Retrieval

A pluggable `SearchProvider` seam in `@byline/core` (registered on
`ServerConfig.search`, validated at `initBylineCore()` via `validateSearchConfig`)
with a built-in Postgres full-text driver. The present-state reference is
[docs/05-reading-and-delivery/07-search.md](docs/05-reading-and-delivery/07-search.md);
the forward-looking landscape for the unbuilt phases is
`docs/05-reading-and-delivery/08-search-extraction-strategy.md`.

- **Interface & types**: `SearchProvider` (`capabilities` + `upsert` / `remove` /
  `search` / `reindex?`), the type-enriched `SearchDocument` (a role-tagged
  `SearchField[]` projection), `SearchQuery` / `SearchResults`, and `SearchCapabilities`
  live in `packages/core/src/@types/search-types.ts`. The provider is a pure index
  **sink** — it never reads source documents.
- **Collection search config**: `CollectionDefinition.search = { body?, facets?, filters?, zones? }`
  (`SearchFieldDecl = string | { field, boost? }`). The implementor names fields by
  the part they play; core derives each field's type from the schema. Nothing auto-pulled.
- **Assembler**: `buildSearchDocument()` (`packages/core/src/services/build-search-document.ts`)
  normalises a locale-resolved document into a `SearchDocument`. `title` is display-only
  (searchability comes from `body`); `richText` body fields flatten via the editor-agnostic
  `ServerConfig.fields.richText.toText` seam (`RichTextToTextFn`; Lexical impl `lexicalToText` /
  `lexicalEditorToTextServer` in `@byline/richtext-lexical/server`). Facets resolve to
  `{ id: target counter, term: target useAsTitle }`.
- **Driver**: `@byline/search-postgres` — `postgresSearch({ pool, defaultLocale?, autoMigrate? })`
  takes the host's pg pool (e.g. `db.pool`), not a client. Weighted `tsvector` (title/body→A–D by
  boost, facet terms→C), `websearch_to_tsquery` + `ts_rank`, `ts_headline` highlights, per-locale
  `regconfig`. **Owns its schema** via numbered SQL in `migrations/` + `migrate(pool)` (its own
  `byline_search_migrations` table) — NOT in the host's Drizzle stream. `capabilities`:
  `weighting` + `highlights` today; facets/where/fuzzy/bm25/semantic are `false` (follow-ups).
- **Indexing**: lifecycle hooks call `client.collection(x).indexDocument(id)` / `removeFromIndex(id)`
  (orchestration lives in `@byline/client`, not the provider). `indexDocument` re-syncs by reading
  the published view per locale (`status: 'published'`, `onMissingLocale: 'omit'`) and
  upsert/remove — idempotent across publish / unpublish / draft-over-published / edit. Published-only.
  Worked example: `apps/webapp/byline/collections/docs/hooks.ts`.
- **Reindex**: `client.collection(x).reindex()` (clears the slice via `provider.reindex()`, then
  walks published docs) asserts the `collections.<path>.reindex` ability (a uniform 7th collection
  verb). Admin trigger: `ReindexButton` (`@byline/host-tanstack-start/admin-shell/collections`) via
  the reusable `CollectionAdminConfig.listActions` header slot + the `reindexCollection` server fn.
- **Query surface**: `client.collection(x).search(options)` (`CollectionHandle.search`) asserts the
  collection `read` ability, scopes to the collection + `published`, and returns the lightweight hit
  tier (title / path / score / highlights). The docs frontend (drawer-modal search → `/docs/search?q=`
  SSR results route) is the worked example. **Planned**: cross-collection `client.search({ zone })`,
  `hydrate`, structured `where` filtering, facet aggregation, and row-level `beforeRead` auth on search.

### Admin interface i18n (`@byline/i18n`)

Shipped in v2.6.0 — the admin shell renders end-to-end in English and French, with hooks for plugins / custom fields / extensions to register their own translations.

- **Package layout**: `@byline/i18n` root is React-free (types, `mergeTranslations`, ICU formatter, locale resolver — safe in server contexts). `@byline/i18n/react` is the single React barrel (`I18nProvider`, `useTranslation`, `LanguageMenu`). `@byline/i18n/admin` ships the `byline-admin` namespace bundle + the `adminTranslations({ locales })` factory.
- **Host integration**: `packages/host-tanstack-start/src/i18n/*` wires the per-request locale (`resolve-locale.ts`), cookie helpers (`locale-cookie.ts`), and server-side translator (`server-translator.ts`). Server fns under `packages/host-tanstack-start/src/server-fns/i18n/*` handle locale persistence (`set-locale.ts`) and client-graph-safe reads (`get-active-locale.ts`).
- **Per-user persistence**: `byline_admin_users.preferred_locale` column (varchar 16, nullable) wired through `packages/admin/src/modules/admin-account/{commands,service,schemas}.ts` for self-service writes. The locale cascade is `preferred_locale → byline_admin_lng cookie → Accept-Language → defaultLocale`.
- **Extension surface**: third-party plugins, custom fields, and host-side components register their own namespaces via the same `mergeTranslations(adminTranslations({...}), pluginFactory({...}))` pattern. The worked example is `apps/webapp/byline/collections/media/i18n/` (custom `MediaListView` with `webapp-media-admin` namespace). See [`docs/07-internationalization/index.md`](docs/07-internationalization/index.md) for the full design.
- **Validation messages**: schemas in `@byline/core/validation` emit stable codes (e.g. `password.tooShort`); the `translateValidationError(t, message)` helper in `@byline/admin/react` maps codes onto the active locale at render time. Keeps `@byline/core` i18n-agnostic.
- **Boot validator**: `packages/core/src/services/i18n-validator.ts` runs at `initBylineCore()` — fails fast on missing bundles, warns on key drift between locales.

### Collections → Forms → Patches → Storage

- Form state + patch accumulation: `packages/admin/src/forms/form-context.tsx`
- Form layout/validation: `packages/admin/src/forms/form-renderer.tsx`
- Path widget (system metadata): `packages/admin/src/forms/path-widget.tsx`
- Field widgets emit patches: `packages/admin/src/fields/field-renderer.tsx` + per-type widgets in sibling subdirectories
- Presentational form layout (tabs/rows/groups): `packages/admin/src/presentation/{group,row,tabs}.tsx`
- Editor-shared widgets (status badge, diff modal): `packages/admin/src/widgets/`
- DB schema: `packages/db-postgres/src/database/schema/index.ts`; migrations in `packages/db-postgres/src/database/migrations`
