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
