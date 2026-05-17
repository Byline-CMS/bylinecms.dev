# Testing

Two test suites, two commands:

- **`pnpm test`** — unit tests across every package. Pure CPU, no Postgres needed.
- **`pnpm test:integration`** — DB-backed tests for `@byline/client` and `@byline/db-postgres`. Runs against a dedicated `byline_test` Postgres database — never `byline_dev`.

CI runs both, in the same job, against a Postgres service container.

## TL;DR

```sh
# One-time per machine
cp packages/db-postgres/.env.example      packages/db-postgres/.env       # dev DB
cp packages/db-postgres/.env.test.example packages/db-postgres/.env.test  # test DB
cp packages/client/.env.test.example      packages/client/.env.test       # client integration tests
cd postgres && ./postgres.sh up -d  # start the container
pnpm db:init       # create byline_dev (one-time)
pnpm db:init:test  # create byline_test (one-time)

# Every test run
pnpm test              # unit suites — no DB
pnpm test:integration  # integration suites — requires byline_test
```

The integration runner auto-migrates `byline_test` on startup (Drizzle's migrator is idempotent) and truncates every public table between test files. A crashed prior run can't leak state into the next.

## What runs where

| Package | `pnpm test` (unit) | `pnpm test:integration` (DB-backed) |
|---|---|---|
| `@byline/core` | ✅ vitest `--mode=node` | — |
| `@byline/auth` | ✅ vitest `--mode=node` | — |
| `@byline/admin` | ✅ vitest `--mode=node` | — |
| `@byline/ai` | ✅ vitest `--mode=node` | — |
| `@byline/cli` | ✅ vitest `--passWithNoTests` | — |
| `@byline/host-tanstack-start` | ✅ vitest `--mode=node` | — |
| `@byline/client` | ✅ vitest `--mode=node` (`*.test.node.ts`) | ✅ vitest `--mode=integration` (`*.integration.test.ts`) |
| `@byline/db-postgres` | ❌ no-op (every test needs a DB) | ✅ tsx + node:test (`*.test.ts`) |

Only `@byline/client` and `@byline/db-postgres` write to `byline_test`. Everything else is pure in-memory.

`pnpm test` (root) runs `turbo run test`. `pnpm test:integration` (root) runs `turbo run test:integration --concurrency=1` — the concurrency flag serialises the two DB-backed suites so each one's per-file `TRUNCATE` doesn't wipe the other's seeded fixtures mid-run.

## Two databases, two purposes

| Database | Used by | Lifecycle |
|---|---|---|
| `byline_dev` | `pnpm dev` (webapp, admin UI) | Created once, lives as long as you want, manual seed |
| `byline_test` | `pnpm test:integration` | Created once, wiped by the test runner between test files |

Both live in the same local Postgres container (`postgres/docker-compose.yml`). Same `byline` role. The split is logical, not physical — local Postgres is a dev tool.

## Safety guards

Two layers prevent any test from ever pointing at the wrong database:

1. **Script-level (braces)** — `packages/db-postgres/src/database/common.sh` refuses to source any env whose `POSTGRES_DATABASE` doesn't end in `_dev` or `_test`. `db_init.sh` and `db_init_test.sh` both go through it.
2. **Runtime (belt)** — `assertTestDatabase()` in `packages/db-postgres/src/lib/test-db.ts` parses the connection string at the top of every test bootstrap and throws unless the DB name ends in `_test`. Imported by both the vitest globalSetup (`packages/client/tests/_global-setup.ts`) and the node:test bootstrap (`packages/db-postgres/src/lib/test-bootstrap.ts`).

## Isolation strategy

- **Migrate once per test run** — vitest globalSetup migrates before any test file loads; node:test bootstrap migrates per file-process (idempotent, sub-second).
- **TRUNCATE between files** — every table in `public` (except `__drizzle_migrations`) is truncated with `RESTART IDENTITY CASCADE` at the top of each test file. Existing per-test track-and-clean code (e.g. the admin tests) stays in place as a belt; TRUNCATE is the braces.
- **No transaction-per-test** — the storage code opens its own transactions; wrapping tests in one would break the lifecycle paths under test.

Parallelisation across test files (template-database clone) is deferred until wall-clock pain shows up — current `--test-concurrency=1` + vitest default-serial is fast enough.

## CI

`.github/workflows/ci.yml` runs on every pull request and on direct pushes to `develop` / `main`. Two jobs:

- **lint-and-typecheck** — `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck`.
- **test-suite** — boots a Postgres service container with `byline_test` pre-created, writes `.env.test` files from the job-level env block, then runs `pnpm test` (unit) followed by `pnpm test:integration`. Both run in the same job so they share one `pnpm install`.

Both jobs skip when the head commit starts with `chore(release):` so version-bump pushes from `pnpm version-packages` don't trigger redundant runs. Tag pushes (`git push --tags`) and `gh release create` aren't listened to at all, so the local-only release flow stays silent.

`concurrency: cancel-in-progress` cancels superseded runs on the same branch — quick fix-up pushes don't queue behind older builds.

When branch protection is enabled in repo settings, CI becomes a hard gate with no workflow change required.

## Running a single test

```sh
# vitest (client)
cd packages/client && pnpm vitest run --mode=integration tests/integration/client-read.integration.test.ts

# node:test (db-postgres) — pass the file as the last arg via test:one
cd packages/db-postgres && pnpm test:one src/modules/storage/tests/storage-versioning.test.ts
```
