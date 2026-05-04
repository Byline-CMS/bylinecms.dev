# @byline/cli — TODO

A scratchpad for picking up where we left off. See `README.md` for end-user docs.

## Intro

`@byline/cli` is a guided installer that adds Byline CMS to an *existing* TanStack Start application. It is intentionally **not** a project scaffolder (no `create-byline-app`) — Byline's host story today is "drop into a TanStack Start app you already own," and the installer reflects that.

The shape is an [Astro `astro add`](https://docs.astro.build/en/reference/cli-reference/#astro-add)-style wizard: each phase runs `detect → plan → preview → confirm → apply`, and the user sees a unified diff before any file is written. Phases are independently re-runnable via `--only` / `--from` / `--to` and progress is tracked in `.byline-install.json` so re-runs resume.

## Design decisions

These are the load-bearing choices we made while building. Re-read before changing.

1. **Per-phase `--apply` posture.** Phases default to `confirm` mode (preview → prompt → write). Two phases (`deps`, `scaffold`) default to `auto` because they are low-risk and tedious to do by hand. `--apply` flips all confirm-mode phases to auto; `--no-apply` flips the auto-mode pair back to confirm. This came from the user's preference for "slow, step-by-step, clear instructions."
2. **No AST codemods except for the three import-injection sub-edits in the `wire` phase.** Everything else is template-merge or "show snippet, bail to manual." Specifically, `vite.config.ts` is byte-compared against the canonical template — if it matches, we overwrite; if it doesn't, we print the snippet and mark the sub-edit as `manual` in state. We do not attempt to merge.
3. **`apps/webapp/vite.config.ts` is canonical.** Every Byline-on-TanStack-Start install gets that exact file (argon2 shim, externals, optimizeDeps). When argon2 is removed from the dep tree, update the canonical template *and* the wire phase's match check at the same time.
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
| env       | ⬜ stub         | Generate JWT secret, prompt admin email/password, write or print .env |
| deps      | ⬜ stub         | Auto-mode by default; respect detected pm |
| scaffold  | ⬜ stub         | Auto-mode by default; copy `byline/` tree |
| wire      | ⬜ stub         | 5 sub-edits, each independently confirmed; see below |
| routes    | ⬜ stub         | Drop `(byline)/admin/**` at root of user's `src/routes/` |
| ui        | ⬜ stub         | Copy serialization components to `<ui-dir>` (default `src/ui/byline`) |
| verify    | ⬜ stub         | `pnpm typecheck`, optionally hit `/admin` |

Stubs all return `state: 'pending'` with a "not yet implemented" message and honor the Phase contract so they show up correctly in `doctor`.

## Next up

1. **`env` phase** — natural pair after `db-init`. Generate `JWT_SECRET = crypto.randomBytes(64).toString('base64url')`, prompt for `ADMIN_EMAIL` / `ADMIN_PASSWORD` (mask), build `DATABASE_URL` from db-phase answers, render the .env preview, write or print snippet. Single source of truth for env vars: `src/manifest/env.ts` (file does not exist yet).
2. **`deps` phase** — single source of truth for required deps: `src/manifest/deps.ts` (file does not exist yet). Diff against the user's `package.json`, run `<pm> add <pkgs>`. Auto-mode by default. Detect peer mismatches and warn.
3. **`scaffold` phase** — copy `src/templates/byline/**` (currently empty — populate from `apps/webapp/byline/`, stripping dev-only seed scripts) into `<cwd>/byline/` with `{{var}}` substitution. Auto-mode by default. Prompt for `--examples` (default yes during beta) which gates copying `collections/` + `seeds/`.
4. **`wire` phase — five independent sub-edits.** Each reports its own state (`pending|done|manual|skipped`) into `state.wireSubEdits`:
   - `wire/server-ts.ts` — inject `import '../byline/server.config'`
   - `wire/start-ts.ts` — inject `serializationAdapters: [...]` into `createStart` options
   - `wire/root-tsx.ts` — inject `import '../../byline/admin.config'`
   - `wire/tsconfig.ts` — add `compilerOptions.paths['~/*'] = ['./byline/*']`
   - `wire/vite-config.ts` — byte-compare against canonical template; overwrite or bail to snippet
   Use `ts-morph` ONLY for the three import-injection sub-edits. tsconfig is a JSON edit. vite is the byte-compare branch.
5. **`routes` phase** — copy `src/templates/routes/(byline)/admin/**` (currently empty — populate from `apps/webapp/src/routes/(byline)/admin/`) into `<cwd>/src/routes/`. Prompt for `--admin-path` (default `/admin`); rename the route group accordingly via path/file rename.
6. **`ui` phase** — copy `src/templates/ui-byline/**` (currently empty — populate from `apps/webapp/src/ui/byline/` *if/when that directory exists* — currently the serialization components live elsewhere; locate them) into `<cwd>/<ui-dir>/`. Default `<ui-dir>` is `src/ui/byline`.
7. **`verify` phase** — run `<pm> typecheck`. If it passes, optionally start the dev server in the background, fetch `<admin-path>`, report the response code, kill the server.
8. **Docker DB strategy** — currently `dbPhase` returns `blocked` if the user picks docker. Implement: copy the bundled docker-compose into `<cwd>/postgres/`, `docker compose up -d`, poll `pg_isready`, then continue. Bundled compose lives at `src/templates/docker/` (currently empty).

## Followups / cleanup

- Add `packages/cli/src/manifest/{deps,env}.ts` as the single sources of truth before any phase that needs them lands. They will be imported by `deps` / `env` phases AND by `doctor` (so doctor can report missing deps without re-running phases).
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
