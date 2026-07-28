# @byline/cli — TODO

A scratchpad for picking up where we left off. See `README.md` for end-user
documentation.

## Purpose

`@byline/cli` is a guided installer that adds Byline CMS to an existing TanStack
Start application. It is not a project scaffolder. Each phase runs
`detect → plan → preview → confirm → apply`, and progress is recorded in
`.byline-install.json` so interrupted runs can resume.

## Design decisions

These are the load-bearing choices to preserve when extending the CLI.

1. **Per-phase confirmation.** Confirm phases preview before writing; auto
   phases run without a second confirmation. `--force` bypasses completion
   state but does not relax file or database safety.
2. **No broad config rewrites.** Import injection uses AST edits; scaffold,
   route, and UI copies use concrete planned writes. Recognized generated
   predecessors may be replaced, while divergent user-owned files remain
   manual.
3. **The database adapter registry is the extension point.**
   `src/lib/database/adapters.ts` owns package names, environment keys, URL
   codecs, prerequisites, and baseline capability.
   `src/lib/database/provisioner.ts` owns the matching live-database
   implementations. Adding an adapter must extend both registries and supply
   dialect templates; it must not add adapter switches throughout the phases.
4. **PostgreSQL is the default, not a hidden assumption.** Interactive and
   `--database` selection are persisted before dependency, environment,
   scaffold, or setup checks run.
5. **Scaffolds are layered and hand-maintained.** Common minimal and example
   trees live under `src/templates/byline/` and
   `src/templates/byline-examples/`. Adapter overlays live under
   `src/templates/dialects/<adapter>/byline/` and
   `src/templates/dialects/<adapter>/byline-examples/`. Later layers replace
   the same relative path, so an adapter owns its `server.config.ts` without
   duplicating the common tree.
6. **One fresh-install baseline is bundled per adapter.** Before each release,
   the adapter's Drizzle migrations are squashed and copied into
   `src/templates/migrations/<adapter>/`. The exact adapter package version is
   pinned to the CLI version. The baseline is not published from
   `@byline/db-*`, is not an upgrade history, and is never applied to an
   occupied database.
7. **Existing installations use native SQL upgrades.** Numbered, idempotent
   scripts live under `packages/db-postgres/sql/` and
   `packages/db-mysql/sql/`. Operators take them from the Git tag for the
   target release and apply them explicitly. The CLI does not apply this
   stream.
8. **Database inspection precedes mutation.** Without `--reset`, `db-init`
   inspects the target before requesting the application password. It accepts
   only a missing or empty target and refuses both a Byline schema and
   unrelated occupied storage. `--force` does not bypass this guard.
9. **Reset is an explicit destructive exception.** `--reset` skips occupied
   target inspection, drops and recreates the database, and requires
   confirmation or `--i-mean-it`. A completed setup also requires `--force`.
10. **Provisioning is adapter-owned and uses drivers.** PostgreSQL uses `pg`;
    MySQL uses `mysql2`. Neither implementation shells out. PostgreSQL installs
    `pgcrypto`; MySQL verifies the 8.0.14 floor and rejects MariaDB.
11. **Search migrations stay separate.** Search packages own disposable,
    numbered migration streams and generated example configurations call the
    selected provider's `migrate(pool)`. Search SQL is not copied into the
    storage baseline.
12. **Small command surface.** `init`, `setup`, and `doctor` cover installation
    and recovery. Prefer `init --only <phase>` over new subcommands.

## Status

| Phase | State | Notes |
|---|---|---|
| preflight | ✅ done | Node ≥ 20, Git check, package-manager detection |
| prompts | ✅ done | Routes, examples, and import-doc choices |
| host | ✅ done | Detects TanStack Start and required host files |
| db | ✅ done (existing server) | PostgreSQL/MySQL selection and administrator connection verification; Docker remains blocked |
| db-init | ✅ done | Adapter provisioner, occupied-target refusal, reset path, and bundled fresh baseline |
| env | ✅ done | Writes only the selected adapter's connection variable plus common app/auth variables |
| deps | ✅ done | Exact selected adapter; compatible release ranges for other Byline packages; workspace-link validation |
| wire | ✅ done | Server bootstrap, uploads, Start, TypeScript, and Vite integration |
| routes | ✅ done | `_byline` route group and custom mount-path alignment |
| scaffold | ✅ done | Common plus adapter-specific template layers; generated-type scripts |
| seed-admin | ✅ done | Idempotent super-admin seed |
| seed-docs | ✅ done | Optional example-document seed |
| ui | ✅ done | Portable admin UI files |
| verify | ⬜ deferred | Typecheck and optional admin-route smoke |

The deferred `verify` phase is not registered in the runnable phase list.

## Next up

1. **`verify` phase.** Run the owning package manager's typecheck and
   optionally start the development server, request the configured admin path,
   report the result, and stop the server.
2. **Docker database strategy.** The database phase currently blocks this
   choice. A future implementation needs an adapter-owned service template,
   readiness probe, and lifecycle rather than a PostgreSQL-specific path.
3. **Custom `--ui-dir`.** The UI phase currently targets `src/ui/byline`.
   Supporting another location requires rewriting the scaffold's
   `@/ui/byline` imports consistently.

## Follow-ups

- Keep the scaffold smoke contracts exhaustive over the adapter registry and
  compile every dialect `server.config.ts` fixture so package API changes fail
  CI.
- If template drift becomes costly, add a synchronization command that
  rebuilds the common layers from `apps/webapp` and reapplies the documented
  portability transforms. Database overlays and baselines remain
  adapter-owned inputs to that command.
- ts-morph currently prints modified host files with its own quote and
  semicolon style. A future polish pass could read the application's Biome
  settings before printing.
- Add `--json` output for scripting.
- Reserve `byline add <kind> <name>` for a later collection, block, or field
  scaffolding workflow.
