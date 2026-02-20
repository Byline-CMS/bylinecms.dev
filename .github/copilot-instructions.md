# Copilot instructions (Byline CMS)

Byline CMS is a **pnpm + Turborepo** monorepo (prototype / PoC). Key packages:
- `apps/webapp`: Tanstack Start in SPA mode + React admin UI .
- `packages/byline` (`@byline/core`): core config/types/patch logic
- `packages/db-postgres` (`@byline/db-postgres`): Postgres adapter (Drizzle)
- `packages/shared` (`@byline/shared`): shared crypto/schemas utilities

## Daily commands
- Dev (UI + API): `pnpm dev` (Turbo) → UI `http://localhost:5173`, API `http://localhost:3001`
- Build: `pnpm build`
- Lint/format: `pnpm lint` (Biome). Prefer Biome fixes; don’t introduce ESLint/Prettier workflows.
- Tests: `pnpm test` (Turbo). App-specific: `cd apps/webapp && pnpm test` or `pnpm test:one -- <file>`

## Database workflows (prototype)
- Start Postgres (docker-compose wrapper): `cd postgres && ./postgres.sh up -d`
- Initialize DB: `cd packages/db-postgres/src/database && ./db_init.sh`
- Drizzle migrations (from repo root): `pnpm drizzle:generate` then `pnpm drizzle:migrate`
- Seed sample docs: `cd apps/webapp && pnpm tsx --env-file=.env byline/seed-bulk-documents.ts`
- Env files live in `apps/webapp/.env` and `packages/db-postgres/.env` (see `.env.example`)

## Architecture patterns to follow
- **Config is side-effect loaded**:
  - Browser: `apps/webapp/src/main.tsx` imports `../byline.client.config.ts`
  - Server: `apps/webapp/routes/api` Tanstack server API routes imports `../byline.server.config.*`
- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/webapp/src/routes` with generated `src/routeTree.gen.ts`. Route files export `Route = createFileRoute(...)`.
- **Validation**: Zod is the default runtime validator (e.g. API query parsing in `apps/webapp/src/lib/api-utils.ts`).
- **DB schema is in one place**: `packages/db-postgres/src/database/schema/index.ts`; migrations in `packages/db-postgres/src/database/migrations`.
- **Imports**: internal packages use `@byline/*`; webapp uses `@/` alias for `apps/webapp/src`.

## Collections → forms → patches → universal storage (the “engine”)
- **Collection definitions** live in `apps/webapp/byline/collections` (e.g. `docs.ts`). These definitions drive both list columns and the edit UI.
- **Dynamic edit forms** are generated from `CollectionDefinition.fields`:
  - Form state + patch accumulation: `apps/webapp/src/ui/fields/form-context.tsx`
  - Form layout / validation glue: `apps/webapp/src/ui/fields/form-renderer.tsx`
  - Field widgets + arrays/blocks emit patches: `apps/webapp/src/ui/fields/field-renderer.tsx`
- **Patch-based updates**: the webapp can POST `{ data, patches }` (see `apps/webapp/src/modules/collections/data.ts`). Server applies patches via `applyPatches` in `apps/webapp/src/routes/api/$collection/$id/patches.ts`.
- **Universal storage model**: on write, docs are flattened into typed `store_*` rows; on read, rows are UNION’d and reconstructed:
  - Flatten + insert: `packages/db-postgres/src/storage/storage-commands.ts` → `createDocumentVersion()` calls `flattenFields()` (`packages/db-postgres/src/storage/storage-utils.ts`) and inserts into `store_text`, `store_numeric`, `store_boolean`, `store_datetime`, etc.
  - Reconstruct: `packages/db-postgres/src/storage/storage-queries.ts` → `getDocumentById(..., reconstruct: true)` reads all `store_*` values then `reconstructFields()` (`packages/db-postgres/src/storage/storage-utils.ts`).

## Repo conventions
- Node engine is `^18.20.2 || >=20.9.0` (see root `package.json`).
- Keep changes minimal and consistent with prototype intent (many files explicitly say “prototype”).
