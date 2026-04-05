---
name: test
description: Run tests. Pass a file path to run a single test, or no arguments to run all tests.
allowed-tools: Bash
argument-hint: [path/to/file.test.ts] [--mode=node]
---

Run tests via Turbo or per-package.

- If `$ARGUMENTS` includes a file path, run that single test from the appropriate package directory:
  - For `apps/webapp`: `cd apps/webapp && npx vitest run --mode=jsdom $ARGUMENTS`
  - For `packages/core`: `cd packages/core && npx vitest run --mode=node $ARGUMENTS`
- If `$ARGUMENTS` is empty, run all tests: `pnpm test`
- If `$ARGUMENTS` includes `--mode=node`, pass that mode flag accordingly

Report results clearly: pass/fail counts and any failure details.
