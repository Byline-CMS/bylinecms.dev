# @byline/cli

Guided installer for [Byline CMS](https://github.com/Byline-CMS/bylinecms.dev) into an existing TanStack Start application.

## Usage

```sh
cd <your-tanstack-start-app>
npx @byline/cli init
```

The installer is a step-by-step wizard. For each phase that mutates files, it prints a unified diff and waits for your confirmation before writing — you can apply the change, skip it, or copy a snippet to make the change yourself.

```sh
byline init                    Run the wizard, resuming from the last completed phase.
byline init --only db-init     Re-run a single phase.
byline init --from wire        Resume from a specific phase.
byline init --apply            Skip the per-phase confirmation prompt (still prints diffs).
byline init --dry-run          Show every change but write nothing.
byline doctor                  Inspect the current app and report what's wired.
```

See `byline init --help` for the full flag list.

### Already-wired apps (post-manual-config)

If you wired Byline into your app by hand (collections, `server.config.ts`, env, routes, scaffold files all in place) and just need to provision the database and seed, use `setup` instead of `init`:

```sh
byline setup                       Provision DB, then seed super-admin and example docs.
byline setup --no-seed-admin       Provision DB and seed docs only.
byline setup --no-seed-docs        Provision DB and seed super-admin only.
byline setup --no-seed-admin --no-seed-docs
                                   Provision DB only.
byline setup --reset --i-mean-it   Destructive: drop and recreate the database.
```

`setup` runs only the `db` → `db-init` → `seed-admin` → `seed-docs` phases — it does not touch project files. For new TanStack Start apps that need the full scaffold, use `byline init`.
