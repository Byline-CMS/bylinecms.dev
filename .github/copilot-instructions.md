# Copilot instructions (Byline CMS)

Byline CMS is a **pnpm + Turborepo** monorepo (prototype / PoC). Key packages:
- `apps/webapp`: TanStack Start in SPA mode + React admin UI.
- `packages/byline` (`@byline/core`): core config, types, patch logic, workflow, Zod schema builder.
- `packages/db-postgres` (`@byline/db-postgres`): Postgres adapter (Drizzle ORM).
- `packages/db-remote` (`@byline/db-remote`): remote/stub adapter (placeholder).

## Daily commands
- Dev (UI + API): `pnpm dev` (Turbo) → UI `http://localhost:5173`, API `http://localhost:3001`
- Build: `pnpm build` (4 packages: `@byline/core`, `@byline/db-postgres`, `@byline/db-remote`, `@byline/webapp`)
- Lint/format: `pnpm lint` (Biome). Prefer Biome fixes; don't introduce ESLint/Prettier workflows.
- Tests: `pnpm test` (Turbo). App-specific: `cd apps/webapp && pnpm test` or `pnpm test:one -- <file>`
  - Core tests: `cd packages/byline && pnpm test` (Vitest — patches + workflow).
  - DB tests: `cd packages/db-postgres && pnpm test` (tsx --test — requires running Postgres).

## Database workflows (prototype)
- Start Postgres (docker-compose wrapper): `cd postgres && ./postgres.sh up -d`
- Initialize DB: `cd packages/db-postgres/src/database && ./db_init.sh`
- Drizzle migrations (from repo root): `pnpm drizzle:generate` then `pnpm drizzle:migrate`
- Seed sample docs: `cd apps/webapp && pnpm tsx --env-file=.env byline/seed-bulk-documents.ts`
- Env files live in `apps/webapp/.env` and `packages/db-postgres/.env` (see `.env.example`)

---

## Key architectural decisions

### 1. Universal storage (EAV-per-type)
Documents are stored in typed `store_*` tables (`store_text`, `store_numeric`, `store_boolean`,
`store_datetime`, `store_json`, etc.) rather than one JSONB column per document. A custom path
notation (e.g. `content.1.photoBlock.0.display`) addresses each value. This gives proper column
types, indexability, and future full-text/GIN indexing.

- **Flatten** (write): `packages/db-postgres/src/storage/storage-utils.ts` → `flattenFields()` +
  `packages/db-postgres/src/storage/storage-commands.ts` → `createDocumentVersion()`.
- **Reconstruct** (read): `packages/db-postgres/src/storage/storage-queries.ts` →
  `getDocumentById(..., reconstruct: true)` → `reconstructFields()`.
- Block and array items carry a stable `_id` (UUIDv7) stored in `store_meta` for identity tracking
  across patches. The `_id` is injected by `attachMetaToDocument()` on reconstruct and **must be
  skipped** by `flattenFields` and `field-renderer` via `.find(k => k !== '_id')`.

### 2. Immutable versioning
Document versions are saved by default (UUIDv7 time-ordered). `ROW_NUMBER() OVER PARTITION`
resolves the "current" version via the `current_documents` database view. Status changes mutate
the existing version row in-place (status is lifecycle metadata, not content).

### 3. Patch-based updates
The client accumulates `DocumentPatch[]` and POSTs `{ data, patches }`. The server applies patches
via `applyPatches` (`packages/byline/src/patches/`). Three patch families: `field.*`, `array.*`,
`block.*`. This design is a foundation for future collaborative editing (OT/CRDT).

### 4. Schema / presentation split
Collection definitions (`CollectionDefinition`) are server-safe data — no UI concerns. A separate
`CollectionAdminConfig` (via `defineAdmin()`) holds presentation: columns, field positions, custom
formatters. This mirrors Django's "model vs ModelAdmin" pattern.

---

## Architecture patterns to follow

### Config & routing
- **Config is side-effect loaded**:
  - Browser: `apps/webapp/src/client.tsx` imports `../byline.client.config.ts`
  - Server: `apps/webapp/routes/api` TanStack server API routes import `../byline.server.config.*`
- **Dashboard routing**: `@tanstack/react-router` file-based routes under `apps/webapp/src/routes`
  with generated `src/routeTree.gen.ts`. Route files export `Route = createFileRoute(...)`.
- **Validation**: Zod is the default runtime validator (e.g. `apps/webapp/src/lib/api-utils.ts`).
  The Zod schema builder in `packages/byline/src/schemas/zod/builder.ts` generates per-collection
  schemas (including dynamic status enums derived from workflow config).
- **DB schema is in one place**: `packages/db-postgres/src/database/schema/index.ts`;
  migrations in `packages/db-postgres/src/database/migrations`.
- **Imports**: internal packages use `@byline/*`; webapp uses `@/` alias for `apps/webapp/src`.

### Collections → forms → patches → storage (the "engine")
- **Collection definitions** live in `apps/webapp/byline/collections` (e.g. `docs.ts`).
  Each file exports a `CollectionDefinition` (schema) and a `CollectionAdminConfig` (UI).
- **Dynamic edit forms** are generated from `CollectionDefinition.fields`:
  - Form state + patch accumulation: `apps/webapp/src/ui/fields/form-context.tsx`
  - Form layout / validation glue: `apps/webapp/src/ui/fields/form-renderer.tsx`
  - Field widgets + arrays/blocks emit patches: `apps/webapp/src/ui/fields/field-renderer.tsx`
- **Patch-based updates**: `apps/webapp/src/modules/admin/collections/data.ts` →
  `updateCollectionDocumentWithPatches()`. Server applies patches in
  `apps/webapp/src/routes/admin/api/$collection/$id/patches.ts`.

### Workflow system
- **Types**: `WorkflowStatus { name, label?, verb? }`, `WorkflowConfig { statuses, defaultStatus? }`,
  `defineWorkflow()` — all in `packages/byline/src/@types/collection-types.ts`.
- **Logic**: `packages/byline/src/workflow/workflow.ts` — `getWorkflow()`, `getWorkflowStatuses()`,
  `getDefaultStatus()`, `validateStatusTransition()` (±1 step or reset-to-first),
  `getAvailableTransitions()`.
- **Subpath export**: `@byline/core/workflow` (also re-exported from `@byline/core` main barrel).
- **API route**: `PATCH /admin/api/$collection/$id/status` — validates transition, calls
  `setDocumentStatus()` which UPDATEs the existing version row.
- **DB adapter**: `IDocumentCommands.setDocumentStatus({ document_version_id, status })`.
- **UI wiring**: `FormRenderer` receives `nextStatus` + `workflowStatuses` props.
  The transition button shows `verb` (action label); the status indicator shows `label`.
  The list view also resolves status labels via `workflowStatuses`.
- **Zod integration**: `createBaseSchema(collection?)` in the schema builder derives the `status`
  enum dynamically from the collection's workflow statuses (falls back to
  `['draft', 'published', 'archived']`).
- Collections define workflows via `defineWorkflow()` in their definition files. The `statuses`
  array is ordered — position determines allowed transitions.

### API routes (TanStack Start server handlers)
All admin API routes live under `apps/webapp/src/routes/admin/api/$collection/`:
- `index.ts` — `GET` (list with pagination/search/status filter) + `POST` (create).
- `$id/index.ts` — `GET` (single doc) + `PATCH` (update via patches).
- `$id/patches.ts` — `POST` patch application endpoint.
- `$id/status.ts` — `PATCH` workflow status transition.
- `$id/history.ts` — `GET` version history.

## Repo conventions
- Node engine is `^18.20.2 || >=20.9.0` (see root `package.json`).
- Keep changes minimal and consistent with prototype intent (many files explicitly say "prototype").
- Always verify with `pnpm build` (4 packages must pass) and `pnpm test` after changes.
- The `_id` field on array/block items is synthetic metadata — never persist it via `flattenFields`,
  never treat it as a data key in renderers.
