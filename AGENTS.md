# Repository Guidance

## Sources Of Truth

- Use root/package manifests, `turbo.json`, and `.github/workflows/ci.yml` for commands; prose that conflicts with executable config is stale.
- `CLAUDE.md` is the broad architecture index. Follow its linked present-state docs, but verify command and transport details against manifests.
- `.github/copilot-instructions.md` describes an older repository shape and is not authoritative.
- This is a pnpm 11 + Turborepo workspace (`packages/*`, `apps/*`, `benchmarks/storage`), requiring Node >=20.9; CI uses Node 22.

## Commands And Gates

- Root commands fan out through Turbo: `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:integration`.
- `pnpm lint` runs Biome with `--write --unsafe`; it modifies files. Do not introduce ESLint or Prettier.
- CI static gate order is `pnpm byline:generate:check`, `pnpm lint`, `pnpm typecheck`, then `pnpm knip`.
- Use package filters while iterating, e.g. `pnpm --filter @byline/core test` or `pnpm --filter @byline/webapp typecheck`.
- Run one DB test from its package: `pnpm vitest run --mode=integration <test-file>`.
- `pnpm build` may print Rolldown `INVALID_ANNOTATION` warnings from Lexical dependencies; check the exit status rather than treating those warnings as failures.

## Documentation

- Developer documents under `docs/` use YAML front matter with `title`, `path`, and a one-sentence `summary`, followed by one H1 and a `Companions:` list immediately below it.
- The front matter `title` and first H1 text must match exactly. Document import and processing removes the first H1 and uses the front matter title in its place.
- Write for developers evaluating or learning Byline. Introduce the main concept and vocabulary first, then move into APIs, limits, compatibility boundaries, implementation references, and tests.
- Use clear, direct, complete sentences and concrete subjects such as “Byline’s admin user interface.” Avoid vague shorthand, metaphors, slogans, compressed fragments, repeated explanations, and unstated assumptions.
- Preserve technical qualifications and verify claims against current code, manifests, and tests. Link to companion documents instead of duplicating their full explanations.
- Run `pnpm docs:check` and `git diff --check` after creating or revising documentation. The `/document` command in `.claude/commands` and `.opencode/commands` contains the full workflow.

## Package Boundaries

- `packages/core` owns framework-independent types, lifecycle/auth/query/patch logic, configuration, and the pure `@byline/core/codegen` emitter.
- `packages/client` is the in-process SDK; `packages/db-postgres` owns storage primitives; `packages/host-tanstack-start` owns TanStack server-function transport.
- Keep generic React primitives in `packages/ui`; CMS/editor concepts belong in `packages/admin`.
- There is no stable public document HTTP API. Admin document operations currently use host-adapter server functions.
- App-owned schema/config lives in `apps/webapp/byline`; `apps/webapp/src` owns the host/public application.

## App Configuration Boundaries

- `apps/webapp/byline/collections/index.ts` is the single server-safe collection tuple. Import schema modules only; keep React/admin presentation imports out.
- `apps/webapp/byline/public.ts` is the blessed client-safe configuration facade for public code. Do not expose admin/server config through it.
- Server client getters (`getAdminBylineClient`, `getPublicBylineClient`, `getSystemBylineClient`, `getViewerBylineClient`, `isPreviewActive`) come from `@byline/client/server` — typed via the generated `Register` merge, server-only (browser export condition throws). Never import it into browser code.
- Server bootstrap is a side effect of `apps/webapp/src/server.ts` importing `byline/server.config.ts`.
- Keep both `byline/admin.config.ts` registrations: `_byline/route.tsx` `beforeLoad` protects child loaders, while `_byline/route.lazy.tsx` protects initial hydration. An eager import leaks the admin/editor graph into public bundles.

## Generated Types And Files

- After changing a collection, field, or block schema, run `pnpm byline:generate` and commit `apps/webapp/byline/generated/collection-types.ts`.
- App code imports collection types from `@byline/generated-types` (the generated file declaration-merges into that stub package and into `@byline/client`'s `Register`); never import the generated file by path.
- `pnpm byline:generate:check` is read-only and fails on missing/stale output; `byline/collection-types.contract.ts` checks generated types exactly against inference.
- Never hand-edit generated collection types or `apps/webapp/src/routeTree.gen.ts`; both are excluded from Biome intentionally.
- Generated collection types are canonical unpopulated read shapes. Keep operation-specific populate overlays near the query.
- `@byline/core/codegen` is Node-only; do not re-export it from the browser-safe `@byline/core` root.

## Storage And Lifecycle

- Document storage is typed EAV. The adapter-independent field/store map is `packages/core/src/storage/field-store-map.ts`.
- Array/block `_id` values are synthetic identity metadata. Do not persist or render them as schema data.
- Ordinary reads/writes should use `@byline/client` or core lifecycle services. Direct `db.commands.*` / `db.queries.*` bypass auth, hooks, normalization, and lifecycle behavior and are only for seeds, migrations, tests, and internal tooling.
- Content updates create immutable versions. Status, document paths, and advertised locales use dedicated non-versioned commands.
- Canonical numeric values are integer/float = `number`, decimal = precision-preserving `string`; stored file sizes restore as `number`. Core lifecycle normalization enforces this before hooks/storage.
- Relation `hasMany`, `minItems`, and `maxItems` affect both inferred/generated types and collection fingerprints.

## Database And Migrations

- Local unit tests use no database. `pnpm test:integration` requires Postgres plus package-local `.env.test` files and a one-time `pnpm db:init:test`.
- Integration safety rejects databases whose names do not end in `_test`; DB bootstrap accepts only `_dev` or `_test` names.
- Client and db-postgres integration suites share one database, migrate once, truncate between files, and must remain serial (`maxWorkers: 1`, `isolate: false`, root concurrency 1).
- Drizzle schema source is `packages/db-postgres/src/database/schema/index.ts`; use `pnpm drizzle:generate` and do not format `migrations/meta` manually.
- Keep `packages/cli/src/templates/migrations` synchronized with db-postgres Drizzle migrations.
- `packages/search-postgres/migrations` is an independent numbered migration stream; do not merge it into Drizzle migrations.

## Test Discovery

- Package node tests conventionally use `*.test.node.ts`; client integration tests use `*.integration.test.ts`; db-postgres integration tests live under `src/**/tests/**/*.test.ts`.
- `packages/db-postgres` intentionally has no unit suite: its `pnpm test` is a message; use its integration mode.
- Check each package's `vitest.config.ts` before adding browser tests: plain `*.test.tsx` is not discovered by every package's default `pnpm test`.
- Playwright is separate: `pnpm --filter @byline/webapp test:e2e` requires migrated/seeded `byline_dev`, `.env.local` admin credentials, and Chromium. Tests mutate data serially.

## Commits

- When asked to commit, use conventional messages matching history (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`) and keep independently verifiable phases separate.
