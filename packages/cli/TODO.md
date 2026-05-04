# @byline/cli — TODO

A scratchpad for picking up where we left off. See `README.md` for end-user docs.

## Intro

`@byline/cli` is a guided installer that adds Byline CMS to an *existing* TanStack Start application. It is intentionally **not** a project scaffolder (no `create-byline-app`) — Byline's host story today is "drop into a TanStack Start app you already own," and the installer reflects that.

The shape is an [Astro `astro add`](https://docs.astro.build/en/reference/cli-reference/#astro-add)-style wizard: each phase runs `detect → plan → preview → confirm → apply`, and the user sees a unified diff before any file is written. Phases are independently re-runnable via `--only` / `--from` / `--to` and progress is tracked in `.byline-install.json` so re-runs resume.

## Design decisions

These are the load-bearing choices we made while building. Re-read before changing.

1. **Per-phase `--apply` posture.** Phases default to `confirm` mode (preview → prompt → write). Two phases (`deps`, `scaffold`) default to `auto` because they are low-risk and tedious to do by hand. `--apply` flips all confirm-mode phases to auto; `--no-apply` flips the auto-mode pair back to confirm. This came from the user's preference for "slow, step-by-step, clear instructions."
2. **No AST codemods except for the three import-injection sub-edits in the `wire` phase.** Everything else is template-merge or "show snippet, bail to manual." Specifically, `vite.config.ts` is byte-compared against the canonical template — if it matches, we overwrite; if it doesn't, we print the snippet and mark the sub-edit as `manual` in state. We do not attempt to merge.
3. **`apps/webapp/vite.config.ts` is canonical.** Every Byline-on-TanStack-Start install gets that exact file (`ssr.external` for `sharp` / `@byline/storage-local` / `@byline/admin` / `@byline/db-postgres`, the matching `optimizeDeps.exclude`, and the standard plugin set). The argon2 shim that used to live here is gone — `@byline/admin` now uses a pure-JS argon2id and no longer needs externalising or shimming. If anyone reintroduces a native dep that needs Vite plumbing, update the canonical template *and* the wire phase's byte-compare reference at the same time.
4. **i18n stays isolated from the user.** The `(byline)/admin` route group is dropped at the *root* of the user's `src/routes/`, not nested under any locale directory. The user's app i18n strategy is none of our business.
5. **Templates are hand-maintained for v1** under `src/templates/byline/`. They are *not* generated from `apps/webapp/byline/`. If drift becomes a problem, write `pnpm --filter @byline/cli sync-templates`.
6. **Migrations are bundled in the CLI** (`src/templates/migrations/`) rather than resolved from `@byline/db-postgres`. The published db-postgres tarball ships only `dist/`. Long-term, add `src/database/migrations/**` to db-postgres's `files` field and have the CLI resolve from `require.resolve('@byline/db-postgres/package.json')`. Until then, copy migrations into the CLI templates whenever new ones are generated.
7. **db-init is non-destructive by default.** `CREATE IF NOT EXISTS` for both role and database. Destructive reset requires `--reset` AND either `--i-mean-it` or an interactive y/N defaulting to no. The shell `db_init.sh` is a *dev reset tool*; the installer is not.
8. **All identifiers go through `client.escapeIdentifier()` and are pre-validated against `/^[a-z_][a-z0-9_]{0,62}$/`.** Postgres can't parameterize identifiers; the regex is the safety net. Passwords always go through `$1` parameters or `client.escapeLiteral()`.
9. **Three-connection model in db-init.** (a) superuser → `postgres` for role/db provisioning, (b) superuser → new db for extensions (per-database), (c) app role → new db for migrations. This is structural, not negotiable.
10. **No `psql` shell-out.** Everything goes through the `pg` Node client. Users only need Node + a reachable Postgres.
11. **Small command surface.** `init`, `doctor`, and (deferred) `add`. Resist adding subcommands; use `init --only <phase>` for re-runs.

## Status

| Phase     | State          | Notes |
|-----------|----------------|-------|
| preflight | ✅ done         | Node ≥ 20, git check, package-manager detect |
| host      | ✅ done         | Detects TanStack Start dep + required files |
| db        | ✅ done (existing only) | Docker strategy is stubbed and returns blocked |
| db-init   | ✅ done         | Full TS port + drizzle migrate |
| env       | ✅ done         | Generates JWT secret, prompts admin email/password, composes DB_CONNECTION_STRING from db answers + in-process `ctx.secrets.dbPassword` (re-prompt / `BYLINE_DB_PASSWORD` fallback for `--only env`); preserves existing keys. Manifest at `src/manifest/env.ts`. |
| deps      | ✅ done         | Auto-mode. Manifest at `src/manifest/deps.ts` (lockstep `BYLINE_VERSION`, separate `HOST_TANSTACK_VERSION`). Diffs against `package.json`, batches runtime + dev installs, dispatches via detected pm. |
| scaffold  | ✅ done         | Auto-mode. Two-tree overlay: `src/templates/byline/` (always-copied minimal — 6 files) + `src/templates/byline-examples/` (53 files; full lift of `apps/webapp/byline/` with the one `@/utils/utils.general` import inlined). Examples overlay supersedes base for `server.config.ts` / `admin.config.ts` / `seed.ts`. Non-destructive — skips files that already exist. |
| seed-admin | ✅ done        | Confirm-mode. Runs `<pm> tsx byline/seed.ts` (or `bun byline/seed.ts`) — reads `BYLINE_SUPERADMIN_EMAIL`/`BYLINE_SUPERADMIN_PASSWORD` from `.env`, calls the idempotent `seedSuperAdmin()` from `@byline/admin/admin-users`. Pre-flights existence of `byline/seed.ts`, `byline/seeds/admin.ts`, `.env` and bails to `blocked` with a clear "run X first" message if anything's missing. Sits between `scaffold` and `wire`. |
| wire      | ✅ done         | Five independent sub-edits under `src/phases/wire/` (`server-ts`, `start-ts`, `root-tsx`, `tsconfig`, `vite-config`). Each reports `done | skipped | manual | blocked` into `state.wireSubEdits`. ts-morph drives the three import-injection edits; jsonc-parser drives the comment-preserving tsconfig edit; vite is byte-compared against canonical at `src/templates/host/vite.config.ts` (manual + snippet on mismatch — never auto-merged). Phase returns `partial` if any sub-edit is `manual`. **Canonical updated 2026-05-04** to the modern Nitro shape — see (4) below. |
| routes    | ✅ done         | Confirm-mode. Lifts the 14 route stubs from `apps/webapp/src/routes/(byline)/` into `src/templates/routes/(byline)/`, copies into `src/routes/(byline)/` at install time. `--admin-path` (default `/admin`) renames the leading directory segment AND rewrites the `/(byline)/admin` prefix inside every route-id string literal. The sign-in sibling and the `(byline)` group itself stay fixed. Non-destructive — skips existing files. |
| ui        | ✅ done         | Auto-mode. Lifts `apps/webapp/src/ui/byline/` (29 files) into `src/templates/ui-byline/` plus 4 self-contained stubs: bundled `utils/image-sources.ts` + `utils/to-kebab-case.ts` (lifted from `src/ui/utils/`), `types/i18n.ts` (`Locale = string`), and `components/link/lang-link.tsx` (single-locale `<Link>` pass-through). All `@/i18n/*` and `@/ui/utils/*` imports were rewritten in the templates to point at the bundled stubs so the install builds out of the box. Target hardcoded to `src/ui/byline` for v1 (custom `--ui-dir` is a followup — would need the same prefix-rewrite trick the routes phase uses). Non-destructive. End-of-phase note flags the three customisation points. |
| verify    | ⬜ stub         | `pnpm typecheck`, optionally hit `/admin` |

Stubs all return `state: 'pending'` with a "not yet implemented" message and honor the Phase contract so they show up correctly in `doctor`.

## Next up

1. **`verify` phase** — run `<pm> typecheck`. If it passes, optionally start the dev server in the background, fetch `<admin-path>`, report the response code, kill the server.
2. **Docker DB strategy** — currently `dbPhase` returns `blocked` if the user picks docker. Implement: copy the bundled docker-compose into `<cwd>/postgres/`, `docker compose up -d`, poll `pg_isready`, then continue. Bundled compose lives at `src/templates/docker/` (currently empty).
3. **Custom `--ui-dir` for the `ui` phase.** Currently hardcoded to `src/ui/byline`. To support custom dirs, mirror the routes-phase pattern: rewrite the `@/ui/byline` prefix in every lifted `.ts` / `.tsx` import to whatever `<ui-dir>` resolves to (`src/<segment>/byline` → `@/<segment>/byline`).

## Followups / cleanup

- `doctor` should consume `DEP_SPECS` (from `src/manifest/deps.ts`) and `ENV_SPECS` (from `src/manifest/env.ts`) to report missing deps and missing env keys without re-running the install.
- The byline-examples template tree is a one-shot lift from `apps/webapp/byline/` (committed at the time scaffold landed). Drift is the cost of design decision #5 — when it bites, add `pnpm --filter @byline/cli sync-templates` that re-runs the lift (and re-applies the `@/utils/utils.general` → inline `formatNumber` fix in `media-list-view.tsx`, plus any future portability patches). The same script should also re-copy:
  - `apps/webapp/vite.config.ts` → `src/templates/host/vite.config.ts` (wire byte-compare reference)
  - `apps/webapp/src/routes/(byline)/` → `src/templates/routes/(byline)/` (route stubs)
  - `apps/webapp/src/ui/byline/` → `src/templates/ui-byline/` (re-applying the import-rewrite recipe: `@/i18n/i18n-config(.ts)?` → `@/ui/byline/types/i18n`, `@/i18n/components/lang-link` → `@/ui/byline/components/link/lang-link`, `@/ui/utils/*` → `@/ui/byline/utils/*`)
  - `apps/webapp/src/ui/utils/{image-sources,to-kebab-case}.ts` → `src/templates/ui-byline/utils/`
- ts-morph rewrites strings in `src/server.ts` / `src/start.ts` / `src/routes/__root.tsx` with double quotes and trailing semicolons even when the surrounding file uses single-quote / no-semi style. Biome's auto-format on next lint pass corrects this, but if a smoother UX is desired, the wire phase could read the user's `biome.json` style and pass matching `quoteKind` / `useTrailingCommas` options into ts-morph's print options.
- Add a CI smoke test: a fixture that's a freshly-`create`d TanStack Start app, run `byline init --apply --yes` against it on Linux + macOS, assert `pnpm typecheck` passes after.
- Long-term: ship migrations from `@byline/db-postgres` directly (`files: ["dist", "src/database/migrations"]`), drop the bundled copy in `src/templates/migrations/`, resolve via `require.resolve('@byline/db-postgres/package.json')` and `path.dirname(...) + '/src/database/migrations'`.
- The `Context.cliFlags.force` escape hatch in `runner.ts` is referenced but not surfaced as a CLI flag yet. Either wire `--force` through `init.ts` or remove the check.
- `--json` output mode for scripting (NDJSON of phase results) was specced but not implemented.
- `byline add <kind> <name>` (collection / block / field scaffolding) is reserved for v2.

## Files to revisit when adding the next phase

- `src/phases/index.ts` — replace the relevant `stubPhase(...)` entry with the real phase import.
- `src/types.ts` — add any new fields to `Answers` if the phase needs to persist user input.
- `src/state.ts` — add a setter for any new `Answers` field if it deserves a typed accessor.
- `TODO.md` — tick off the row in the Status table and move the entry into the Status notes column.
