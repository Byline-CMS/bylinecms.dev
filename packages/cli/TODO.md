# @byline/cli — TODO

A scratchpad for picking up where we left off. See `README.md` for end-user docs.

## Intro

`@byline/cli` is a guided installer that adds Byline CMS to an *existing* TanStack Start application. It is intentionally **not** a project scaffolder (no `create-byline-app`) — Byline's host story today is "drop into a TanStack Start app you already own," and the installer reflects that.

The shape is an [Astro `astro add`](https://docs.astro.build/en/reference/cli-reference/#astro-add)-style wizard: each phase runs `detect → plan → preview → confirm → apply`, and the user sees a unified diff before any file is written. Phases are independently re-runnable via `--only` / `--from` / `--to` and progress is tracked in `.byline-install.json` so re-runs resume.

## Design decisions

These are the load-bearing choices we made while building. Re-read before changing.

1. **Per-phase `--apply` posture.** Confirm phases preview before writing; auto phases run without a second confirmation. `--force` bypasses completed detection but does not relax file safety.
2. **No broad config rewrites.** Import injection uses AST edits; scaffold, route, and UI copies use concrete planned writes. A missing or recognized canonical Vite predecessor is safe to install, while a divergent config is always manual.
3. **`apps/webapp/vite.config.ts` is canonical.** Every Byline-on-TanStack-Start install gets that exact file (`ssr.external` for `sharp` / `@byline/storage-local` / `@byline/admin` / `@byline/db-postgres`, the matching `optimizeDeps.exclude`, and the standard plugin set). The argon2 shim that used to live here is gone — `@byline/admin` now uses a pure-JS argon2id and no longer needs externalising or shimming. If anyone reintroduces a native dep that needs Vite plumbing, update the canonical template *and* the wire phase's byte-compare reference at the same time.
4. **i18n stays isolated from the user.** The `_byline/admin` pathless layout is dropped at the *root* of the user's `src/routes/`, not nested under any locale directory. The user's app i18n strategy is none of our business.
5. **Templates are hand-maintained for v1** under `src/templates/byline/`. They are *not* generated from `apps/webapp/byline/`. If drift becomes a problem, write `pnpm --filter @byline/cli sync-templates`.
6. **Migrations are bundled in the CLI** (`src/templates/migrations/`) rather than resolved from `@byline/db-postgres`. The published db-postgres tarball ships only `dist/`. Long-term, add `src/database/migrations/**` to db-postgres's `files` field and have the CLI resolve from `require.resolve('@byline/db-postgres/package.json')`. Until then, copy migrations into the CLI templates whenever new ones are generated.
7. **db-init is non-destructive by default.** `CREATE IF NOT EXISTS` for both role and database. Destructive reset requires `--reset` AND either `--i-mean-it` or an interactive y/N defaulting to no. The shell `db_init.sh` is a *dev reset tool*; the installer is not.
8. **All identifiers go through `client.escapeIdentifier()` and are pre-validated against `/^[a-z_][a-z0-9_]{0,62}$/`.** Postgres can't parameterize identifiers; the regex is the safety net. Passwords always go through `$1` parameters or `client.escapeLiteral()`.
9. **Three-connection model in db-init.** (a) superuser → `postgres` for role/db provisioning, (b) superuser → new db for extensions (per-database), (c) app role → new db for migrations. This is structural, not negotiable.
10. **No `psql` shell-out.** Everything goes through the `pg` Node client. Users only need Node + a reachable Postgres.
11. **Small command surface.** `init`, `setup`, and `doctor` cover installation and recovery. Resist adding subcommands; use `init --only <phase>` for focused re-runs.

## Status

| Phase     | State          | Notes |
|-----------|----------------|-------|
| preflight | ✅ done         | Node ≥ 20, git check, package-manager detect |
| host      | ✅ done         | Detects TanStack Start dep + required files |
| db        | ✅ done (existing only) | Docker strategy is stubbed and returns blocked |
| db-init   | ✅ done         | Full TS port + drizzle migrate |
| env       | ✅ done         | Generates JWT secret, prompts admin email/password, composes BYLINE_DB_POSTGRES_CONNECTION_STRING from db answers + in-process `ctx.secrets.dbPassword` (re-prompt / `BYLINE_DB_PASSWORD` fallback for `--only env`); preserves existing keys. Manifest at `src/manifest/env.ts`. |
| deps      | ✅ done         | Requires registry ranges wholly within major 3 with a 3.21.0 floor; verifies bare links only against uniquely named, included workspace package manifests and blocks unresolved/incompatible links without replacing them. Root-owned settings use membership-verified workspace discovery. |
| scaffold  | ✅ done         | Plans each file and package/Turbo script write. Generated artifacts/scripts are detected structurally, existing user files are preserved, and copied import-doc tests are excluded. |
| seed-admin | ✅ done        | Confirm-mode. Runs `<pm> tsx byline/seed.ts` (or `bun byline/seed.ts`), reads credentials from `.env`, and calls the idempotent `seedSuperAdmin()`. Pre-flights scaffold and env files before running. |
| wire      | ✅ done         | Handles server bootstrap/uploads, Start setup, tsconfig, and Vite. Missing/canonical predecessor Vite files are safe writes; divergent user configs remain manual. |
| routes    | ✅ done         | Plans the `_byline` route group, rewrites custom admin filesystem segments and route IDs, and safely aligns `byline/routes.ts`. Divergent runtime config remains manual. |
| ui        | ✅ done         | Plans portable UI writes using the bundled locale type. Example block renderers and generated block-type imports are omitted when examples are disabled. |
| verify    | ⬜ stub         | `pnpm typecheck`, optionally hit `/admin` |

The deferred `verify` phase is not currently registered in the runnable phase list.

## Next up

1. **`verify` phase** — run `<pm> typecheck`. If it passes, optionally start the dev server in the background, fetch `<admin-path>`, report the response code, kill the server.
2. **Docker DB strategy** — currently `dbPhase` returns `blocked` if the user picks docker. Implement: copy the bundled docker-compose into `<cwd>/postgres/`, `docker compose up -d`, poll `pg_isready`, then continue. Bundled compose lives at `src/templates/docker/` (currently empty).
3. **Custom `--ui-dir` for the `ui` phase.** Currently hardcoded to `src/ui/byline`. To support custom dirs, mirror the routes-phase pattern: rewrite the `@/ui/byline` prefix in every lifted `.ts` / `.tsx` import to whatever `<ui-dir>` resolves to (`src/<segment>/byline` → `@/<segment>/byline`).

## Followups / cleanup

- `doctor` should consume `DEP_SPECS` (from `src/manifest/deps.ts`) and `ENV_SPECS` (from `src/manifest/env.ts`) to report missing deps and missing env keys without re-running the install.
- The byline-examples template tree is a one-shot lift from `apps/webapp/byline/` (committed at the time scaffold landed). Drift is the cost of design decision #5 — when it bites, add `pnpm --filter @byline/cli sync-templates` that re-runs the lift (and re-applies the `@/utils/utils.general` → inline `formatNumber` fix in `media-list-view.tsx`, plus any future portability patches). The same script should also re-copy:
  - `apps/webapp/vite.config.ts` → `src/templates/host/vite.config.ts` (wire byte-compare reference)
  - `apps/webapp/src/routes/_byline/` → `src/templates/routes/_byline/` (route stubs + pathless layout)
  - `apps/webapp/src/ui/byline/` → `src/templates/ui-byline/` (re-applying the import-rewrite recipe: `@/i18n/i18n-config(.ts)?` → `@/ui/byline/types/i18n`, `@/i18n/components/lang-link` → `@/ui/byline/components/link/lang-link`, `@/ui/utils/*` → `@/ui/byline/utils/*`)
  - `apps/webapp/src/ui/utils/{image-sources,to-kebab-case}.ts` → `src/templates/ui-byline/utils/`
- ts-morph rewrites strings in `src/server.ts` / `src/start.ts` / `src/routes/__root.tsx` with double quotes and trailing semicolons even when the surrounding file uses single-quote / no-semi style. Biome's auto-format on next lint pass corrects this, but if a smoother UX is desired, the wire phase could read the user's `biome.json` style and pass matching `quoteKind` / `useTrailingCommas` options into ts-morph's print options.
- Extend the local scaffold smoke contracts to a fully installed fixture typecheck when a deterministic, network-free host dependency graph is available.
- Long-term: ship migrations from `@byline/db-postgres` directly (`files: ["dist", "src/database/migrations"]`), drop the bundled copy in `src/templates/migrations/`, resolve via `require.resolve('@byline/db-postgres/package.json')` and `path.dirname(...) + '/src/database/migrations'`.
- `--json` output mode for scripting (NDJSON of phase results) was specced but not implemented.
- `byline add <kind> <name>` (collection / block / field scaffolding) is reserved for v2.

## Files to revisit when adding the next phase

- `src/phases/index.ts` — replace the relevant `stubPhase(...)` entry with the real phase import.
- `src/types.ts` — add any new fields to `Answers` if the phase needs to persist user input.
- `src/state.ts` — add a setter for any new `Answers` field if it deserves a typed accessor.
- `TODO.md` — tick off the row in the Status table and move the entry into the Status notes column.
