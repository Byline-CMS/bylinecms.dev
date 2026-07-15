---
description: Run the repository's write-mode Biome lint and formatter, then summarize modifications and remaining errors.
agent: build
---

Run `pnpm lint` from the repository root.

This command is intentionally write-mode: package scripts run `biome check --write --unsafe --diagnostic-level=error`. Afterward, inspect `git status --short` and `git diff`; summarize files Biome changed and list any diagnostics it could not fix. Do not introduce ESLint or Prettier.
