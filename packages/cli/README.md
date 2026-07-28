# @byline/cli

Guided installer for [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev) into an existing TanStack Start application.

## Usage

```sh
cd <your-tanstack-start-app>
npx @byline/cli init
```

The installer is a step-by-step wizard. It prints unified diffs for planned file writes. Confirm-mode phases wait before writing; safe auto phases apply directly unless `--dry-run` is set.

```sh
byline init                    Run the wizard, re-detecting current installation state.
byline init --only db-init     Re-run a single phase.
byline init --from wire        Resume from a specific phase.
byline init --apply            Skip the per-phase confirmation prompt (still prints diffs).
byline init --dry-run          Show every change but write nothing.
byline init --database mysql   Select MySQL without the database prompt.
byline init --apply -y         Apply detected safe scaffold upgrades noninteractively.
byline doctor                  Inspect the current app and report what's wired.
```

See `byline init --help` for the full flag list.

### Database selection

The installer offers PostgreSQL (the default) and MySQL 8.0.14 or later. Pass
`--database postgres` or `--database mysql` to choose noninteractively. MariaDB
is not supported, and the Docker strategy remains deferred; use a running
server with administrator credentials.

The selection controls every database-specific artifact:

| Selection | Package | Connection variable | Server configuration |
|---|---|---|---|
| PostgreSQL | `@byline/db-postgres` | `BYLINE_DB_POSTGRES_CONNECTION_STRING` | `pgAdapter()` and `@byline/db-postgres/admin` |
| MySQL | `@byline/db-mysql` | `BYLINE_DB_MYSQL_CONNECTION_STRING` | `mysqlAdapter()` and `@byline/db-mysql/admin` |

Example installations also receive the matching `@byline/search-postgres` or
`@byline/search-mysql` provider. Minimal installations omit search. The
unselected database package and environment variable are not added.

### Generated collection types

`byline init` creates `byline/generated/collection-types.ts` and adds two application scripts:

```sh
pnpm byline:generate        # regenerate after changing collection or block schemas
pnpm byline:generate:check  # fail without writing when the artifact is missing or stale
```

The application script evaluates `byline/collections/index.ts`; it does not load
`server.config.ts`. That collection tuple remains the runtime registry, while the generated module
is its deterministic, standalone TypeScript projection for typed clients and frontend code. Keep
the artifact committed and run the check in CI.

### Upgrading older scaffolds and packages

The installer checks dependency ranges and required files instead of trusting
old completed phase flags. Run `byline init --apply -y` to apply detected safe
scaffold upgrades. Missing files and recognized canonical predecessors can be
installed, while divergent user-owned scaffold, route, Vite, Turbo, and CI
configuration is left untouched with an explicit manual instruction.

For CLI version `x.y.z`, the selected database adapter is pinned exactly to
`x.y.z` so it matches the bundled schema baseline. Other registry-backed
`@byline/*` dependencies must declare a range within
`>=x.y.z <(x+1).0.0-0`; missing or incompatible declarations are planned at
`^x.y.z`. Local `workspace:*`, `workspace:^`, and `workspace:~` links are never
replaced. Their package version must resolve locally and satisfy the same
compatibility floor, otherwise installation is blocked with a manual
instruction.

In a monorepo, run the CLI from the application directory. App files remain under that directory,
while pnpm settings, Turbo configuration, CI checks, and package-manager lockfile operations use the
nearest workspace root whose declared package patterns include the application. An app excluded by
those patterns remains standalone and cannot mutate the outer workspace configuration.
When the owning workspace declares a package manager through its workspace file, root
`packageManager`, or lockfile, the installer requires that manager and rejects conflicting `--pm`
or previously selected choices before planning dependency writes.
For a package.json-only workspace with no manager metadata, noninteractive runs must pass `--pm`.
Choosing pnpm creates `pnpm-workspace.yaml` with the existing workspace package patterns and
required `allowBuilds` entries together; npm, Yarn, and Bun continue using package.json workspaces.

### Already-wired apps (post-manual-config)

If you wired Byline into your app by hand (collections, `server.config.ts`, env, routes, scaffold files all in place) and just need to provision the database and seed, use `setup` instead of `init`:

```sh
byline setup                       Provision DB, then seed super-admin and example docs.
byline setup --database mysql      Select MySQL when no choice is recorded.
byline setup --no-seed-admin       Provision DB and seed docs only.
byline setup --no-seed-docs        Provision DB and seed super-admin only.
byline setup --no-seed-admin --no-seed-docs
                                   Provision DB only.
byline setup --reset --i-mean-it   Destructive: drop and recreate the database.
byline setup --force               Re-run every phase even if recorded as complete.
byline setup --force --reset --i-mean-it
                                   Full re-run: drop and recreate the database, then re-seed.
```

`setup` runs preflight, resolves and verifies the database selection, checks
the selected adapter's dependencies and environment, then runs `db-init` and
the enabled seed phases. It does not touch project files. Declining or
deferring database selection stops the command before downstream work. For new
TanStack Start apps that need the full scaffold, use `byline init`.

By default `setup` consults `.byline-install.json` and skips phases already
recorded as complete. `--force` bypasses completion state, but it does not turn
the fresh baseline into an upgrade or weaken occupied-database checks.

The ordinary path applies the CLI's release-specific, squashed baseline only
to a missing or empty database. It refuses an existing Byline schema and an
unrelated occupied schema before mutation. Upgrade an existing installation
with the numbered native SQL under `packages/db-postgres/sql` or
`packages/db-mysql/sql` from the target release tag; the CLI does not apply
those upgrade scripts.

Use `--force --reset --i-mean-it` only for an intentional rebuild. Reset skips
occupied-database inspection, drops the named database, reapplies the fresh
baseline, and discards all document data. Without `--i-mean-it`, the reset path
asks for confirmation.
