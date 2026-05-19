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
byline setup --force               Re-run every phase even if recorded as complete.
byline setup --force --reset --i-mean-it
                                   Full re-run: drop and recreate the database, then re-seed.
```

`setup` runs only the `db` → `db-init` → `seed-admin` → `seed-docs` phases — it does not touch project files. For new TanStack Start apps that need the full scaffold, use `byline init`.

By default `setup` consults `.byline-install.json` and skips phases already recorded as complete. Use `--force` to bypass that and re-run every phase against fresh state — useful after a manual DB reset, when you want to re-seed, or to re-verify a setup is healthy. `--force` is non-destructive on its own (migrations re-apply as no-ops, seeds are idempotent); combine with `--reset --i-mean-it` for a full nuke-and-pave, which drops the database and discards all document data. A confirmation prompt fires before either flow runs, unless you pass `-y`.
