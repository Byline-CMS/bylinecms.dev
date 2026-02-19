# Copilot instructions (Byline CMS)

Byline CMS is a **pnpm + Turborepo** monorepo (prototype / PoC). Key packages:
- `apps/dashboard`: Tanstack Start in SPA mode + React admin UI .
- `packages/byline` (`@byline/core`): core config/types/patch logic
- `packages/db-postgres` (`@byline/db-postgres`): Postgres adapter (Drizzle)
- `packages/shared` (`@byline/shared`): shared crypto/schemas utilities

## Daily commands
- Dev (UI + API): `pnpm dev` (Turbo) → UI `http://localhost:5173`, API `http://localhost:3001`
- Build: `pnpm build`
- Lint/format: `pnpm lint` (Biome). Prefer Biome fixes; don’t introduce ESLint/Prettier workflows.
- Tests: `pnpm test` (Turbo). App-specific: `cd apps/dashboard && pnpm test` or `pnpm test:one -- <file>`

## Database workflows (prototype)
- Start Postgres (docker-compose wrapper): `cd postgres && ./postgres.sh up -d`
- Initialize DB: `cd packages/db-postgres/src/database && ./db_init.sh`
- Drizzle migrations (from repo root): `pnpm drizzle:generate` then `pnpm drizzle:migrate`
- Seed sample docs: `cd apps/dashboard && pnpm tsx --env-file=.env byline/seed-bulk-documents.ts`
- Env files live in `apps/dashboard/.env` and `packages/db-postgres/.env` (see `.env.example`)

## Architecture patterns to follow
- **Config is side-effect loaded**:
  - Browser: `apps/dashboard/src/main.tsx` imports `../byline.client.config.ts`
  - Server: `apps/dashboard/routes/api` Tanstack server API routes imports `../byline.server.config.*`
- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/dashboard/src/routes` with generated `src/routeTree.gen.ts`. Route files export `Route = createFileRoute(...)`.
- **Validation**: Zod is the default runtime validator (e.g. API query parsing in `apps/dashboard/src/lib/api-utils.ts`).
- **DB schema is in one place**: `packages/db-postgres/src/database/schema/index.ts`; migrations in `packages/db-postgres/src/database/migrations`.
- **Imports**: internal packages use `@byline/*`; dashboard uses `@/` alias for `apps/dashboard/src`.

## Collections → forms → patches → universal storage (the “engine”)
- **Collection definitions** live in `apps/dashboard/byline/collections` (e.g. `docs.ts`). These definitions drive both list columns and the edit UI.
- **Dynamic edit forms** are generated from `CollectionDefinition.fields`:
  - Form state + patch accumulation: `apps/dashboard/src/ui/fields/form-context.tsx`
  - Form layout / validation glue: `apps/dashboard/src/ui/fields/form-renderer.tsx`
  - Field widgets + arrays/blocks emit patches: `apps/dashboard/src/ui/fields/field-renderer.tsx`
- **Patch-based updates**: the dashboard can POST `{ data, patches }` (see `apps/dashboard/src/modules/collections/data.ts`). Server applies patches via `applyPatches` in `apps/dashboard/src/routes/api/$collection/$id/patches.ts`.
- **Universal storage model**: on write, docs are flattened into typed `store_*` rows; on read, rows are UNION’d and reconstructed:
  - Flatten + insert: `packages/db-postgres/src/storage/storage-commands.ts` → `createDocumentVersion()` calls `flattenFields()` (`packages/db-postgres/src/storage/storage-utils.ts`) and inserts into `store_text`, `store_numeric`, `store_boolean`, `store_datetime`, etc.
  - Reconstruct: `packages/db-postgres/src/storage/storage-queries.ts` → `getDocumentById(..., reconstruct: true)` reads all `store_*` values then `reconstructFields()` (`packages/db-postgres/src/storage/storage-utils.ts`).

## Repo conventions
- Node engine is `^18.20.2 || >=20.9.0` (see root `package.json`).
- Keep changes minimal and consistent with prototype intent (many files explicitly say “prototype”).
