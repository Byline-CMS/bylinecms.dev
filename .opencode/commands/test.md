---
description: Run all tests or a focused test file using the owning package's actual Vitest mode.
agent: build
---

Run tests for `$ARGUMENTS` and report pass/fail counts plus actionable failures.

- If no arguments are provided, run `pnpm test` from the repository root. This is the unit suite and does not require Postgres.
- If a test path is provided, identify its owning workspace and inspect that package's `vitest.config.ts` before choosing the mode.
- Use `--mode=node` for conventional `*.test.node.ts` package tests.
- Use `--mode=integration` for `packages/client/**/*.integration.test.ts` and `packages/db-postgres/src/**/tests/**/*.test.ts`; run from the owning package with `pnpm vitest run --mode=integration <path-relative-to-package>`. These require the package-local `.env.test` and a `_test` Postgres database.
- For webapp browser tests, use its jsdom mode. There is no end-to-end browser suite; do not invoke one.
- Pass through additional flags such as `-t` after selecting the correct package and mode.
- Do not enable parallelism for client/db-postgres integration tests; they share one database and truncate between files.
