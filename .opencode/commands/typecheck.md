---
description: Run TypeScript checking across the monorepo, or for a package named in the arguments.
agent: build
---

Run TypeScript checking for `$ARGUMENTS`.

- With no arguments, run `pnpm typecheck` from the repository root.
- With a workspace package name, run `pnpm --filter <package> typecheck`.
- Report errors grouped by file and preserve the full diagnostic that explains each root cause.
- Remember that Turbo typecheck builds upstream packages; do not mistake those build steps for unrelated changes.
