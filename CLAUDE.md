# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Note: See STORAGE-ANALYSIS.md for ongoing work on the storage system.

## Project Overview

Byline CMS — an open-source, AI-first headless CMS. Currently a prototype/PoC. Licensed MPL-2.0.

## Monorepo Structure

**pnpm + Turborepo** monorepo. Workspaces: `packages/*` and `apps/*`.

| Package | Import alias | Purpose |
|---|---|---|
| `apps/webapp` | `@byline/webapp` | TanStack Start (SSR mode) + React admin UI. Vite dev server on `:5173`, API on `:3001` |
| `packages/core` | `@byline/core` | Types, config, patch logic, workflow, Zod schema builder |
| `packages/db-postgres` | `@byline/db-postgres` | Postgres adapter (Drizzle ORM) |
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
cd apps/webapp && pnpm tsx --env-file=.env byline/seed-bulk-documents.ts  # Seed data
```

Env files: `apps/webapp/.env` and `packages/db-postgres/.env` (copy from `.env.example`).

## Code Style

- **Biome** for linting and formatting. Run `pnpm lint` to auto-fix. Never introduce ESLint or Prettier.
- Biome config: 2-space indent, single quotes, LF line endings, 100-char line width, trailing commas (ES5), no semicolons.
- Import ordering is enforced by Biome: Node builtins → URLs → React → TanStack → packages → local (with blank line separators).

## Architecture

### Universal Storage (EAV-per-type)

Documents are stored in typed `store_*` tables (`store_text`, `store_numeric`, `store_boolean`, `store_datetime`, `store_json`, etc.) rather than one JSONB column. A custom path notation (e.g. `content.1.photoBlock.0.display`) addresses each value.

- **Flatten** (write): `packages/db-postgres/src/storage/storage-utils.ts` → `flattenFields()`
- **Reconstruct** (read): `packages/db-postgres/src/storage/storage-queries.ts` → `reconstructFields()`
- Block/array items carry a stable `_id` (UUIDv7) in `store_meta` for identity tracking. The `_id` is synthetic metadata — **never persist it via `flattenFields`**, never treat it as a data key in renderers.

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

### Config Loading

- Browser: `apps/webapp/src/client.tsx` imports `../byline.client.config.ts`
- Server: API routes import `../byline.server.config.*`

### Routing & API

- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/webapp/src/routes`, generates `src/routeTree.gen.ts`
- **Admin API routes**: `apps/webapp/src/routes/admin/api/$collection/` — RESTful endpoints for CRUD, patches, status transitions, and version history
- **Validation**: Zod via schema builder in `packages/core/src/schemas/zod/builder.ts`

### Collections → Forms → Patches → Storage

- Form state + patch accumulation: `apps/webapp/src/ui/fields/form-context.tsx`
- Form layout/validation: `apps/webapp/src/ui/fields/form-renderer.tsx`
- Field widgets emit patches: `apps/webapp/src/ui/fields/field-renderer.tsx`
- DB schema: `packages/db-postgres/src/database/schema/index.ts`; migrations in `packages/db-postgres/src/database/migrations`
