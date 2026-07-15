---
name: "source-command-lint-fix"
description: "Run Biome lint and format across the project, auto-fixing issues."
---

# source-command-lint-fix

Use this skill when the user asks to run the migrated source command `lint-fix`.

## Command Template

Run from the repo root:

```
pnpm lint
```

This runs `biome check --write --unsafe --diagnostic-level=error` across all workspaces which auto-fixes lint and formatting issues.

After running, summarise what was fixed. If there are remaining errors that couldn't be auto-fixed, list them.
