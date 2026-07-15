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
byline init --force --apply -y Re-detect and safely upgrade an older scaffold noninteractively.
byline doctor                  Inspect the current app and report what's wired.
```

See `byline init --help` for the full flag list.

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

### Upgrading older scaffolds

The v3.21 installer checks dependency ranges and required files instead of trusting old completed
phase flags. Run `byline init --force --apply -y` to apply safe upgrades. Missing files and
recognized canonical predecessors can be installed, while divergent user-owned scaffold, route,
Vite, Turbo, and CI configuration is left untouched with an explicit manual instruction.

Registry-backed `@byline/*` dependencies must declare a range wholly within major 3, starting at
3.21.0 or newer. Local `workspace:*`, `workspace:^`, and `workspace:~` links are never replaced;
their linked package version must resolve locally and satisfy the same range, otherwise installation
is blocked with a manual compatibility instruction. Resolution uses included workspace package
manifests, not `node_modules` registry copies. Older, future-major, or unbounded registry ranges are
planned as upgrades to `^3.21.0`.

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
byline setup --no-seed-admin       Provision DB and seed docs only.
byline setup --no-seed-docs        Provision DB and seed super-admin only.
byline setup --no-seed-admin --no-seed-docs
                                   Provision DB only.
byline setup --reset --i-mean-it   Destructive: drop and recreate the database.
byline setup --force               Re-run every phase even if recorded as complete.
byline setup --force --reset --i-mean-it
                                   Full re-run: drop and recreate the database, then re-seed.
```

`setup` runs only the `db` → `db-init` → `seed-admin` → `seed-docs` phases — it does not touch project files. For new TanStack Start apps that need the full scaffold, use `byline init`.

By default `setup` consults `.byline-install.json` and skips phases already recorded as complete. Use `--force` to bypass that and re-run every phase against fresh state — useful after a manual DB reset, when you want to re-seed, or to re-verify a setup is healthy. `--force` is non-destructive on its own (migrations re-apply as no-ops, seeds are idempotent); combine with `--reset --i-mean-it` for a full nuke-and-pave, which drops the database and discards all document data. A confirmation prompt fires before either flow runs, unless you pass `-y`.
