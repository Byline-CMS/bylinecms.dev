---
title: "Testing"
path: "testing"
summary: "Two suites, two commands: pnpm test (unit, no database) and pnpm test:integration (real PostgreSQL and MySQL). Isolation, safety guards, and how to run a single test file."
---

# Testing

Companions:
- [Development environment and example application](./01-getting-started/02-development-environment.md) — the local database and application setup the integration suite builds on.
- [Markdown Export](./05-reading-and-delivery/04-markdown-export.md) — the agent-facing routes the agent-surface specs pin the served output of.

Two test suites, two commands:

- **`pnpm test`** — unit tests across every package. Pure CPU, no database needed.
- **`pnpm test:integration`** — DB-backed storage, client, and search-provider
  tests. Runs against dedicated `byline_test` PostgreSQL and MySQL databases.

CI runs both in the same job against PostgreSQL and MySQL service containers.

## TL;DR

```sh
# One-time per machine
cp packages/db-postgres/.env.example      packages/db-postgres/.env       # dev DB
cp packages/db-postgres/.env.test.example packages/db-postgres/.env.test  # test DB
cp packages/client/.env.test.example      packages/client/.env.test       # client integration tests
cp packages/search-postgres/.env.test.example packages/search-postgres/.env.test
cp packages/analytics-postgres/.env.test.example packages/analytics-postgres/.env.test
cp packages/db-mysql/.env.example         packages/db-mysql/.env          # MySQL dev DB
cp packages/db-mysql/.env.test.example    packages/db-mysql/.env.test     # MySQL test DB
cp packages/search-mysql/.env.test.example packages/search-mysql/.env.test
cp packages/analytics-mysql/.env.test.example packages/analytics-mysql/.env.test
cd postgres && ./postgres.sh up -d  # start the container
cd ../mysql && ./mysql.sh up -d      # start MySQL
cd ..
pnpm db:init       # create byline_dev (one-time)
pnpm db:init:test  # create byline_test (one-time)
pnpm db:init:test:mysql

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
| `@byline/db-postgres` | ❌ no-op (every test needs a DB) | ✅ vitest `--mode=integration` (`src/**/tests/**/*.test.ts`) |
| `@byline/db-mysql` | ❌ no-op (every test needs a DB) | ✅ shared storage conformance against MySQL |
| `@byline/search-postgres` | ✅ vitest `--mode=node` | ✅ shared search conformance against PostgreSQL |
| `@byline/search-mysql` | ✅ vitest `--mode=node` | ✅ shared search conformance against MySQL |
| `@byline/analytics` | ✅ vitest `--mode=node` | — |
| `@byline/analytics-agent` | ✅ size and privacy contract tests | — |
| `@byline/analytics-postgres` | ✅ bundled migration drift tests | ✅ shared analytics conformance against PostgreSQL |
| `@byline/analytics-mysql` | ✅ bundled migration drift tests | ✅ shared analytics conformance against MySQL |

Only integration-mode suites write to the dedicated test databases. Unit suites
remain in-memory.

`pnpm test` (root) runs `turbo run test`. `pnpm test:integration` (root) runs
`turbo run test:integration --concurrency=1`. The concurrency flag serialises
suites that share a database so their cleanup cannot erase another suite's
fixtures mid-run.

## Development and test databases

| Database name | Used by | Lifecycle |
|---|---|---|
| `byline_dev` | `pnpm dev` (webapp, admin UI) | Created once, lives as long as you want, manual seed |
| `byline_test` | `pnpm test:integration` | Created once, wiped by the test runner between test files |

The local PostgreSQL and MySQL containers each use this logical split. Search
and storage suites only target their engine's `byline_test` database.

## Safety guards

Two layers prevent tests from pointing at the wrong database:

1. **Script-level** — both database adapters' init scripts refuse database
   names that do not end in `_dev` or `_test`.
2. **Runtime** — integration bootstraps parse their connection string and throw
   unless the target database name ends in `_test`.

## Isolation strategy

- **Migrate once per test run** — vitest `globalSetup` migrates before any test file loads. Drizzle's migrator is idempotent so re-runs are cheap.
- **TRUNCATE between files** — `setupFiles` truncates every table in `public` (except `__drizzle_migrations`) with `RESTART IDENTITY CASCADE` via a `beforeAll` at the top of each test file. Existing per-test track-and-clean code (e.g. the admin tests) stays in place as a belt; TRUNCATE is the braces.
- **No transaction-per-test** — the storage code opens its own transactions; wrapping tests in one would break the lifecycle paths under test.

Both `@byline/client` and `@byline/db-postgres` use the same vitest config shape (`globalSetup` + `setupFiles` + `fileParallelism: false` + single-fork pool), so the isolation story is identical across packages.

## CI

`.github/workflows/ci.yml` runs on every pull request and on direct pushes to `develop` / `main`. Two jobs:

- **lint-and-typecheck** — `pnpm install --frozen-lockfile` → `pnpm byline:generate:check` → `pnpm docs:check` → `pnpm lint` → `pnpm typecheck` → `pnpm knip`.
- **test-suite** — boots PostgreSQL and MySQL service containers with
  `byline_test` pre-created, writes `.env.test` files from the job-level env
  block, builds the workspace packages, then runs `pnpm test` followed by
  `pnpm test:integration`.

Both jobs skip when the head commit starts with `chore(release):` so version-bump pushes from `pnpm version-packages` don't trigger redundant runs. Tag pushes (`git push --tags`) and `gh release create` aren't listened to at all, so the local-only release flow stays silent.

`concurrency: cancel-in-progress` cancels superseded runs on the same branch: quick fix-up pushes don't queue behind older builds.

When branch protection is enabled in repo settings, CI becomes a hard gate with no workflow change required.

## Running a single test

The database-backed packages use vitest, so the invocation is the same shape:

```sh
# @byline/client
cd packages/client && pnpm vitest run --mode=integration tests/integration/client-read.integration.test.ts

# @byline/db-postgres
cd packages/db-postgres && pnpm vitest run --mode=integration tests/conformance.integration.test.ts

# @byline/search-postgres
cd packages/search-postgres && pnpm vitest run --mode=integration tests/conformance.integration.test.ts

# @byline/search-mysql
cd packages/search-mysql && pnpm vitest run --mode=integration tests/conformance.integration.test.ts

# @byline/analytics-postgres
cd packages/analytics-postgres && pnpm vitest run --mode=integration tests/conformance.integration.test.ts

# @byline/analytics-mysql
cd packages/analytics-mysql && pnpm vitest run --mode=integration tests/conformance.integration.test.ts
```

The storage conformance entry point runs `@byline/db-conformance` against the
database adapter. The search entry point runs
`@byline/search-conformance` against the real PostgreSQL or MySQL index, including
matching semantics, multilingual parser survival, lifecycle operations,
relative weighting, and analyzer-fingerprint enforcement. The analytics entry
point runs `@byline/analytics-conformance` against a real SQL store, including
concurrent migration startup, daily visitor boundaries, capped rollups,
raw-plus-rollup stitching, maintenance rebuilds, and retention. Narrow any
aggregate file to one case or suite with `-t`:

```sh
pnpm vitest run --mode=integration -t "tampered"
```

Watch mode (re-runs on file change) is a per-package script; run it from inside the package:

```sh
cd packages/core && pnpm test:watch
```

## Browser verification

Byline has no automated browser suite. The Playwright editor smoke suite and the
agent-surface route specifications were removed, and no replacement harness has
been adopted. Do not add Playwright specifications or report a browser
command as passing evidence for a change.

Verify browser behaviour by hand against a running development server, and record
what you exercised and what you observed. Boot the server with the development
Postgres up and `byline_dev` migrated and seeded:

```sh
cd postgres && ./postgres.sh up -d
cd apps/webapp && pnpm tsx byline/seed.ts
cd apps/webapp && pnpm dev
```

Two behaviours are worth knowing before you interact with the admin document
editor. Interactions that land before React hydrates set native input values
without reaching the form context, so the dirty-gated Save button never enables,
and a submit before hydration falls back to the native form post. Wait for
hydration before you click. Documents you create during a check persist in the
long-lived development database, so name them so you can find and remove them
afterwards.

`apps/webapp/tests/manual/` holds hand-written manual scripts for flows that
repay a repeatable checklist, such as repeating-field identity across reorder and
upload. Copy a script to a new file with a fresh timestamp suffix, record the
branch and commit under test, and preserve the completed result log.

The public agent-facing routes — `sitemap.xml`, the `.md` document
representations, and `llms.txt` — no longer have route-level coverage. The
serialization format they expose is still pinned by unit tests in
`packages/core` (`document-to-markdown.test.node.ts`) and
`packages/richtext-lexical`, and the `Accept: text/markdown` negotiation rule is
pinned by `apps/webapp/src/lib/markdown-negotiation.test.ts`. What is unpinned is
the route layer on top: locale prefixing, caching headers, and the redirect
itself. Check those by hand when you change them.
