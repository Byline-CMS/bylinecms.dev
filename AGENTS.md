# Byline CMS repository guidance

Byline is an open-source TypeScript CMS with versioned content, editorial workflow and content translation. This file holds shared instructions for working in the repository.

## Sources Of Truth

- Use root/package manifests, `turbo.json`, and `.github/workflows/ci.yml` for commands; prose that conflicts with executable config is stale.
- Start with the [architecture overview](docs/03-architecture/index.md) and the topic references below. Use dated plans in `specs/` for decision history. Verify shipped behavior against the implementation and tests.
- `.github/copilot-instructions.md` describes an older repository shape and is not authoritative.
- Use the pnpm version pinned in [package.json](package.json) (currently 12.11.2). Turborepo covers `packages/*`, `apps/*` and `benchmarks/storage`. Node >=22.22.2 is required and CI uses Node 22.

## Commands And Gates

- Root commands fan out through Turbo: `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:integration`.
- `pnpm lint` runs Biome with `--write --unsafe`; it modifies files. Do not introduce ESLint or Prettier.
- CI runs `pnpm byline:generate:check`, `pnpm docs:check`, `pnpm lint`, `pnpm typecheck`, `pnpm knip`, `pnpm knip:exports` and `pnpm test:scripts` in that order. See the [workflow](.github/workflows/ci.yml) for artifact, transport and integration gates.
- Use the root Biome config for formatting and import order. It specifies two-space indentation, LF line endings, a 100-column width and single-quoted JavaScript strings.
- Use package filters while iterating, e.g. `pnpm --filter @byline/core test` or `pnpm --filter @byline/webapp typecheck`.
- Run one DB test from its package: `pnpm vitest run --mode=integration <test-file>`.
- `pnpm build` may print Rolldown `INVALID_ANNOTATION` warnings from Lexical dependencies; check the exit status rather than treating those warnings as failures.

## Documentation

- Developer documents under `docs/` use YAML front matter with `title`, `path`, and a one-sentence `summary`, followed by one H1 and a `Companions:` list immediately below it.
- The front matter `title` and first H1 text must match exactly. Document import and processing removes the first H1 and uses the front matter title in its place.
- Write for developers evaluating or learning Byline. Introduce the main concept and vocabulary first, then move into APIs, limits, compatibility boundaries, implementation references, and tests.
- Address the reader as “you” and open each document with what it covers and when to use it. Use clear, direct, complete sentences and concrete subjects such as “Byline’s admin user interface.” Avoid vague shorthand, metaphors, slogans, compressed fragments, repeated explanations, and unstated assumptions.
- Preserve technical qualifications and verify claims against current code, manifests, and tests. Link to companion documents instead of duplicating their full explanations.
- Run `pnpm docs:check` and `git diff --check` after creating or revising documentation. The `/document` command in `.claude/commands` and `.opencode/commands` contains the full workflow.

## Package Boundaries

- `packages/core` owns framework-independent types, lifecycle/auth/query/patch logic, configuration, and the pure `@byline/core/codegen` emitter.
- `packages/client` is the in-process SDK; `packages/db-postgres` and `packages/db-mysql` implement storage primitives; `packages/host-tanstack-start` owns TanStack server-function transport.
- Keep generic React primitives in `packages/ui` and CMS editor concepts in `packages/admin`. The admin form context accumulates patches from field widgets. Use `packages/core/src/patches/` for patch semantics. The Lexical editor adapter lives in `packages/richtext-lexical`.
- There is no stable public document HTTP API. Admin document operations currently use host-adapter server functions.
- App-owned schema/config lives in `apps/webapp/byline`; `apps/webapp/src` owns the host/public application.

## Architecture References

- **Composition and configuration.** `initBylineCore()` composes config, collections and providers. Keep schema declarations server-safe. Pair collection and block schemas with separate admin configuration. [Core composition](docs/03-architecture/02-core-composition.md) · [Blocks](docs/04-collections/02-blocks.md)
- **Authorization and reads.** `@byline/auth` defines actors, sessions and abilities. Core enforces collection access, and admin commands enforce admin-management abilities. Preserve `beforeRead` row scoping and the request's read context through relationship population and hooks. Public reads must use published content, including when a newer draft exists. [Authentication and authorization](docs/07-auth-and-security/01-authn-authz.md) · [Client SDK](docs/05-reading-and-delivery/01-client-sdk.md) · [Relationships](docs/04-collections/03-relationships.md)
- **Field paths.** Use `packages/core/src/paths/` for declaration and instance paths. Persisted storage paths and patch paths are compatibility contracts. Admin field overrides inside a block belong to that block type's admin config. [Path grammar](docs/03-architecture/04-path-grammar.md)
- **Delivery and search.** The host serves published Markdown and `llms.txt`. The client orchestrates indexing of published documents by locale and applies read restrictions to search hits. Providers index projections supplied by core. The SQL drivers share `@byline/search-analysis` and behavior tests in `@byline/search-conformance`. Check provider capabilities before using optional query features. [Markdown export](docs/05-reading-and-delivery/04-markdown-export.md) · [Search API](docs/06-search/03-search-api.md) · [Indexing](docs/06-search/02-indexing-and-reindexing.md)
- **Files and extraction.** Local and S3 storage providers implement the file-storage contract. Extraction types and pure helpers are browser-safe. Verified reads use the server-only `@byline/core/stored-files` entry. Build core before running its extraction root-graph test, which inspects `dist`. Hosts currently own extraction workers, artifact storage and the search join. [Uploads](docs/04-collections/06-file-media-uploads.md) · [Extraction contract](docs/06-search/10-extraction-provider-contract.md)
- **Editor and localization.** Forms, fields, layout and editor widgets live under `packages/admin/src/`. Keep content locales separate from admin interface locales. Add new admin keys to every bundled locale. Core validation emits stable codes and the UI translates them. [Admin UI](docs/09-admin-ui/index.md) · [Admin translations](docs/08-internationalization/02-admin-translations.md) · [Content locales](docs/08-internationalization/03-content-locales.md)
- **Other subsystems.** Scheduled publication operates on a reviewed version. Analytics owns its ingest, storage and rollups. Keep AI execution behind `@byline/ai/server`. The CLI installs Byline into a TanStack Start host. [Scheduling](docs/11-scheduling/02-scheduled-publication.md) · [Analytics](docs/12-analytics/index.md) · [AI package](packages/ai/README.md) · [CLI](docs/01-getting-started/01-cli.md)

## App Configuration Boundaries

- `apps/webapp/byline/collections/index.ts` is the single server-safe collection tuple. Import schema modules only; keep React/admin presentation imports out.
- `apps/webapp/byline/public.ts` is the blessed client-safe configuration facade for public code. Do not expose admin/server config through it.
- Server client getters (`getAdminBylineClient`, `getPublicBylineClient`, `getSystemBylineClient`, `getViewerBylineClient`, `isPreviewActive`) come from `@byline/client/server` — typed via the generated `Register` merge, server-only (browser export condition throws). Never import it into browser code.
- Server bootstrap is a side effect of `apps/webapp/src/server.ts` importing `byline/server.config.ts`.
- Keep both `byline/admin.config.ts` registrations: `_byline/route.tsx` `beforeLoad` protects child loaders, while `_byline/route.lazy.tsx` protects initial hydration. An eager import leaks the admin/editor graph into public bundles. [Admin config registration](docs/09-admin-ui/02-admin-config-registration.md)

## Generated Types And Files

- After changing a collection, field, or block schema, run `pnpm byline:generate` and commit `apps/webapp/byline/generated/collection-types.ts`.
- App code imports collection types from `@byline/generated-types` (the generated file declaration-merges into that stub package and into `@byline/client`'s `Register`); never import the generated file by path.
- `pnpm byline:generate:check` is read-only and fails on missing/stale output; `byline/collection-types.contract.ts` checks generated types exactly against inference.
- Never hand-edit generated collection types or `apps/webapp/src/routeTree.gen.ts`; both are excluded from Biome intentionally.
- Generated collection types are canonical unpopulated read shapes. Keep operation-specific populate overlays near the query.
- `@byline/core/codegen` is Node-only; do not re-export it from the browser-safe `@byline/core` root.

## Storage And Lifecycle

- Document storage is typed EAV. Use `packages/core/src/storage/field-store-map.ts` for field mapping, `store-manifest.ts` alongside it for shared store columns, and `storage-flatten.ts` / `storage-restore.ts` for write/read conversion. Each adapter owns its SQL. [Document storage](docs/03-architecture/01-document-storage.md)
- Array/block `_id` values are synthetic identity metadata. Do not persist or render them as schema data.
- Ordinary reads/writes should use `@byline/client` or core lifecycle services. Direct `db.commands.*` / `db.queries.*` bypass auth, hooks, normalization, and lifecycle behavior and are only for seeds, migrations, tests, and internal tooling.
- Content updates create immutable versions. Status, document paths, and advertised locales use dedicated non-versioned commands.
- Canonical numeric values are integer/float = `number`, decimal = precision-preserving `string`; stored file sizes restore as `number`. Core lifecycle normalization enforces this before hooks/storage.
- Relation `hasMany`, `minItems`, and `maxItems` affect both inferred/generated types and collection fingerprints.

## Database And Migrations

- Start the local database with the helper in [postgres/](postgres/README.md) or [mysql/](mysql/README.md). The full integration suite needs both engines, package-local `.env.test` files and one-time initialization with `pnpm db:init:test` and `pnpm db:init:test:mysql`. Integration safety requires database names ending in `_test`. Local bootstrap scripts accept the designated `_dev` or `_test` targets. [Development environment](docs/01-getting-started/02-development-environment.md) · [Testing](docs/13-testing.md)
- Keep database integration runs serial. Packages share databases, migrate in global setup and truncate between files. Root integration concurrency is 1. Preserve the single-worker and isolation settings in the package Vitest configs.
- Each SQL adapter owns its Drizzle schema under `src/database/schema/`. Use `pnpm drizzle:generate` and leave `migrations/meta` to Drizzle. PostgreSQL core installs use the adapter's immutable `migrations/` SQL and journal. Keep the MySQL CLI baseline synchronized with its adapter. The legacy PostgreSQL hand-applied stream ends at 0015. Inspect existing installations with `byline storage status`, adopt the verified checkpoint with writers fenced, and upgrade journaled installations with `byline storage migrate`. [PostgreSQL upgrades](packages/db-postgres/sql/README.md) · [MySQL upgrades](packages/db-mysql/sql/README.md)
- Search and analytics drivers own independent numbered migration streams. Keep those migrations in their respective packages.

## Test Discovery

- Package node tests conventionally use `*.test.node.ts`; client integration tests use `*.integration.test.ts`; db-postgres integration mode includes `src/**/tests/**/*.test.ts` and `tests/**/*.test.ts`.
- Both SQL adapters run node-mode unit suites via `pnpm test`. Live storage conformance runs in integration mode. CI also runs the S3 conformance suite against an object store during the unit-test step.
- Check each package's `vitest.config.ts` before adding browser tests: plain `*.test.tsx` is not discovered by every package's default `pnpm test`.
- There is no automated browser suite. Playwright was removed; do not add it back or treat a browser command as a gate. Verify browser behaviour by hand against a running dev server and record what you observed.

## Commits

- When asked to commit, use conventional messages matching history (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`) and keep independently verifiable phases separate. Use `git commit -s` for the required DCO sign-off. It is the only permitted commit trailer.
