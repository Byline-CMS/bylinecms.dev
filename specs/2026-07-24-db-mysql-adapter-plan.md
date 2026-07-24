# MySQL Database Adapter (`@byline/db-mysql`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Byline's dialect-independent storage machinery into `@byline/core` behind a conformance test suite (Phase 1), then build `@byline/db-mysql` — core `IDbAdapter` + admin repositories on MySQL 8.0.14+ — against that proven contract (Phase 2).

**Architecture:** Phase 1 is a behaviour-preserving refactor of `@byline/db-postgres`: `flattenFieldSetData` / `restoreFieldSetData` / the store-manifest column data / `resolveStoreTypes` move to `packages/core/src/storage/`, the `UnifiedFieldValue` row shape becomes the formal adapter-boundary contract, and the existing integration tests become a parameterised suite in a new private `packages/db-conformance` package that db-postgres must pass unchanged. Phase 2 ports the adapter to MySQL using the dialect mapping in the spec (CHAR(36) ascii_bin UUIDs, DATETIME(3) UTC, table-emulated counters, READ COMMITTED transactions), with the conformance suite as the correctness gate.

**Tech Stack:** TypeScript (ESM), Drizzle ORM (`drizzle-orm/node-postgres`, `drizzle-orm/mysql2`), mysql2, pg, Vitest, Docker (MySQL 8 official image), GitHub Actions.

**Spec:** `specs/2026-07-24-db-mysql-adapter-design.md` (approved 2026-07-24). The dialect conversion tables in spec Section 2 are normative for every port task below. Companion analysis (not implemented by this plan): `specs/2026-07-24-drizzle-free-adapters-analysis.md`.

**Plan granularity note:** Tasks in this plan are PR-sized (the user will turn them into GitHub issues ~1:1). Steps inside each task are bite-sized. For the mechanical port tasks (Tasks 9–12) the plan specifies exact source files, the normative conversion table, and the verification gate rather than reproducing thousands of lines of ported SQL — the conformance suite, not transcription fidelity, is the acceptance instrument.

## Global Constraints

- Every new source file starts with the MPL-2.0 header block (copy verbatim from any sibling file; it names "Infonomic Company Limited").
- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char lines, ES5 trailing commas. Run `pnpm lint` (repo root) before each commit. Never introduce ESLint/Prettier.
- Import ordering (Biome-enforced): Node builtins → React → TanStack → packages (`@byline/*`) → local relative, blank-line separated. Cross-package imports use the package name; within-package relative imports use the `.js` extension (ESM).
- Commits: conventional format `type(scope): lowercase past-tense message`, single line. Sign-off REQUIRED: `git commit -s` (DCO gate on PRs). `Signed-off-by` is the ONLY permitted trailer — no Co-Authored-By, no AI attribution.
- Monorepo: pnpm + Turborepo. Package-local tests: `cd packages/<pkg> && pnpm test`. Root `pnpm typecheck` covers the workspace. Integration tests need the `byline_test` Postgres database (`pnpm db:init:test` once; runner auto-migrates, truncates between files).
- Engine floor (Phase 2): MySQL 8.0.14+, InnoDB only. Boot check fails fast below the floor.
- UUIDs in MySQL: `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`, app-generated UUIDv7 (`uuid` package, `v7()`), never DB-generated.
- All MySQL timestamp columns: `DATETIME(3)`, UTC by convention (mysql2 pool `timezone: 'Z'`).
- Never use `INSERT IGNORE` — upsert-noop is `INSERT … ON DUPLICATE KEY UPDATE <pk> = <pk>`.
- Phase 1 must not change any observable adapter behaviour. The gate is: full existing integration suite green before and after every Phase 1 task.
- New `@byline/*` package versions release in lockstep with the workspace (current line: 4.x).

---

## Phase 1 — seam hardening (db-postgres only)

### Task 0: Feature branch

**Files:** none (git only)

- [ ] **Step 0.1: Create the branch**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
git checkout develop && git pull
git checkout -b refactor/db-adapter-seam
```

Expected: `Switched to a new branch 'refactor/db-adapter-seam'`.

---

### Task 1: Move flatten / restore / row types / `resolveStoreTypes` to `@byline/core`

**Files:**
- Create: `packages/core/src/storage/storage-flatten.ts` (moved from `packages/db-postgres/src/modules/storage/storage-flatten.ts`)
- Create: `packages/core/src/storage/storage-restore.ts` (moved from `packages/db-postgres/src/modules/storage/storage-restore.ts`)
- Create: `packages/core/src/storage/storage-row-types.ts` (moved from `packages/db-postgres/src/modules/storage/@types.ts` — the `FlattenedFieldValue` union, `UnifiedFieldValue`, `FileStoreVariant`, and friends)
- Create: `packages/core/src/storage/storage-utils.ts` (`resolveStoreTypes` only; `getFirstOrThrow` stays in db-postgres — it is a Drizzle-result helper)
- Create: `packages/core/src/storage/index.ts` (barrel)
- Modify: `packages/core/src/index.ts` (export the new module)
- Modify: `packages/db-postgres/src/modules/storage/storage-commands.ts`, `storage-queries.ts`, `storage-insert.ts`, `storage-store-manifest.ts`, `storage-utils.ts`, `@types.ts` (imports point at `@byline/core`; the old files become re-export shims or are deleted where nothing external imports them)
- Move tests: the pure unit tests among `packages/db-postgres/src/modules/storage/tests/` that exercise flatten/restore round-trips without a database move to `packages/core/src/storage/` as `*.test.node.ts` files (inspect each: any test importing the adapter or `test-db` stays behind for Task 3)

**Interfaces:**
- Consumes: `FieldSet`, `Field` types already in `@byline/core`.
- Produces (later tasks and both adapters rely on these exact names, re-exported from `@byline/core`):
  - `flattenFieldSetData(fields: FieldSet, data: unknown, locale: string): FlattenedFieldValue[]`
  - `restoreFieldSetData(fields: FieldSet, flattenedData: FlattenedFieldValue[], resolveLocale?: string): RestoreResult` where `RestoreResult = { data: any; warnings: string[] }`
  - `extractFlattenedFieldValue(row: UnifiedFieldValue): FlattenedFieldValue | null` (preserve the current exact signature from `storage-restore.ts`)
  - `type UnifiedFieldValue` (unchanged shape — this is the canonical adapter-boundary row)
  - `resolveStoreTypes(fields: FieldSet, fieldNames: string[]): Set<StoreType>`

- [ ] **Step 1.1: Move the files** — `git mv` semantics (move + fix imports), keeping MPL headers. Internal imports inside the moved files change from relative db-postgres paths to core-relative paths; references to `@byline/core` types become relative imports (they are now inside core).
- [ ] **Step 1.2: Update db-postgres imports** — every `from './storage-flatten.js'` (etc.) site imports from `@byline/core` instead. Delete the moved originals.
- [ ] **Step 1.3: Typecheck the workspace**

```bash
pnpm typecheck
```

Expected: clean. Any other package importing these symbols from `@byline/db-postgres` must be found here and repointed (search: `rg "from '@byline/db-postgres'" packages apps | rg -i "flatten|restore|UnifiedFieldValue"`).

- [ ] **Step 1.4: Run moved unit tests in core**

```bash
cd packages/core && pnpm test
```

Expected: PASS, including the relocated flatten/restore tests.

- [ ] **Step 1.5: Run the full db-postgres integration suite (behaviour gate)**

```bash
cd packages/db-postgres && pnpm test:integration
```

Expected: identical pass count to `develop`.

- [ ] **Step 1.6: Commit**

```bash
git add -A && git commit -s -m "refactor(core): moved dialect-independent storage machinery from db-postgres to core"
```

---

### Task 2: Extract the store-manifest column data to core; formalise `normalizeRow`

**Files:**
- Create: `packages/core/src/storage/store-manifest.ts` — the `ColumnDef[]` manifest (name, nullCast, per-store source column names) and `storeTableNames`, moved from `packages/db-postgres/src/modules/storage/storage-store-manifest.ts`. The `nullCast` strings stay abstract type names (`'boolean'`, `'uuid'`, `'text'`…); each adapter maps them to dialect casts.
- Modify: `packages/db-postgres/src/modules/storage/storage-store-manifest.ts` — keeps only the SQL generation (`storeSelectList()`, `UNIFIED_COLUMN_COUNT` re-derivation) consuming the shared manifest, plus a `pgNullCast(nullCast: string): string` mapping (`'uuid'` → `NULL::uuid`, etc.).
- Create: `packages/db-postgres/src/modules/storage/normalize-row.ts`:

```ts
import type { UnifiedFieldValue } from '@byline/core'

/**
 * Canonicalise a raw UNION ALL driver row to the shared UnifiedFieldValue
 * contract. For pg this codifies current behaviour (identity for most
 * columns): BIGINT file_size may arrive as string (tolerated by the type),
 * numeric/decimal arrives as string, timestamptz arrives as Date.
 * The MySQL adapter's counterpart absorbs tinyint(1)→boolean etc.
 */
export function normalizeRow(row: Record<string, unknown>): UnifiedFieldValue {
  return row as unknown as UnifiedFieldValue
}
```

- Modify: `packages/db-postgres/src/modules/storage/storage-queries.ts` and `storage-restore` call sites — raw UNION rows pass through `normalizeRow` before `extractFlattenedFieldValue`.
- Test: `packages/core/src/storage/store-manifest.test.node.ts` — pins column count, column order, and that every `StoreType` has a `sources` entry for its value columns (port the existing `storage-store-manifest.test.ts` assertions that are data-level; SQL-generation assertions stay in db-postgres).

**Interfaces:**
- Produces from `@byline/core`: `storeColumnManifest: ColumnDef[]`, `storeTableNames: Record<StoreType, string>`, `interface ColumnDef { name: string; nullCast: string; sources?: Partial<Record<StoreType, string>> }`.
- Produces in each adapter (convention, not shared code): `normalizeRow(row): UnifiedFieldValue`.

- [ ] **Step 2.1: Move manifest data to core; write the core manifest pin test first and see it fail (module missing), then move and see it pass.**
- [ ] **Step 2.2: Rewire db-postgres `storeSelectList()`** to consume `storeColumnManifest` from core; run `cd packages/db-postgres && pnpm test` (node-mode tests include the manifest SQL pins). Expected: PASS.
- [ ] **Step 2.3: Insert `normalizeRow` at the UNION-row ingestion sites**; run the integration suite. Expected: identical pass count.
- [ ] **Step 2.4: Commit**

```bash
git add -A && git commit -s -m "refactor(core): shared store-column manifest and formalized normalizeRow seam"
```

---

### Task 3: `packages/db-conformance` — the parameterised behavioural suite (storage)

**Files:**
- Create: `packages/db-conformance/package.json`:

```jsonc
{
  "name": "@byline/db-conformance",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",           // consumed as TS source by vitest in-workspace; no build step
  "dependencies": { "@byline/core": "workspace:*", "@byline/auth": "workspace:*" },
  "devDependencies": { "vitest": "catalog:" }   // match workspace conventions
}
```

- Create: `packages/db-conformance/src/index.ts`:

```ts
import type { CollectionDefinition, IDbAdapter } from '@byline/core'

export interface ConformanceHooks {
  /** Construct the adapter under test against the test database. */
  createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter>
  /** Bring the test DB to current schema (idempotent). Called once per run. */
  migrate(): Promise<void>
  /** Truncate all Byline tables. Called between test files. */
  truncate(): Promise<void>
  /** Close pools/connections. */
  teardown(): Promise<void>
}

export function runAdapterConformanceSuite(hooks: ConformanceHooks): void {
  // describe-blocks imported from ./suites/*, each receiving `hooks`
}
```

- Create: `packages/db-conformance/src/suites/…` — one module per current test file, ported from `packages/db-postgres/src/modules/storage/tests/` (14 files: versioning, flatten-reconstruct, field-types, locale-fallback, document-paths, document-tree, document-tree-audit, transactions, delete-locale, document-available-locales, system-fields-direct-write, multi-relation, store-manifest [behavioural parts], restore [behavioural parts]). Mechanical port: replace direct `pgAdapter(...)` construction and `test-db` imports with the injected `hooks`; collection fixtures move with the tests.
- Modify: `packages/db-postgres/tests/` — new `conformance.integration.test.ts` entry that implements `ConformanceHooks` with the existing `test-db.ts` / `test-helper.ts` machinery and calls `runAdapterConformanceSuite(hooks)`.
- Delete (only after Step 3.4 parity check): the ported originals under `packages/db-postgres/src/modules/storage/tests/`.
- Modify: root `pnpm-workspace.yaml` — already covers `packages/*`; verify only.

**Interfaces:**
- Produces: `runAdapterConformanceSuite(hooks: ConformanceHooks): void` and `ConformanceHooks` — Task 8+ (db-mysql) consumes these exact names.

- [ ] **Step 3.1: Package skeleton + empty suite runs green** (`cd packages/db-postgres && pnpm test:integration`).
- [ ] **Step 3.2: Port the 14 storage suites one file at a time.** After each file: run the conformance entry; the ported suite must pass with the same test count as the original file.
- [ ] **Step 3.3: Delete the superseded originals.**
- [ ] **Step 3.4: Parity gate** — total integration test count (conformance + remaining pg-specific tests) equals the pre-Task-3 count; no test lost, none silently skipped:

```bash
cd packages/db-postgres && pnpm test:integration 2>&1 | tail -5
```

- [ ] **Step 3.5: Commit**

```bash
git add -A && git commit -s -m "test(db-conformance): extracted storage integration tests into a parameterised adapter conformance suite"
```

---

### Task 4: Extend the conformance suite — audit, counters, admin repositories

**Files:**
- Create: `packages/db-conformance/src/suites/audit.ts`, `counters.ts` (ported from `packages/db-postgres/src/modules/{audit,counters}/tests/`)
- Create: `packages/db-conformance/src/suites/admin-store.ts` (ported from `packages/db-postgres/src/modules/admin/tests/`) — parameterised over an `AdminStore` factory:
  - Extend `ConformanceHooks` with `createAdminStore?(): Promise<AdminStore>` (optional — an adapter without admin support skips these suites; both real adapters provide it).
- Delete: the ported originals (same parity discipline as Task 3).
- Note: counter tests assert contract semantics only (monotonic per group, gap-tolerant, unknown-group throws for `nextCounterValue`, self-registering for `nextScopedCounterValue`) — NOT `pg_sequences` catalog details. Any existing assertion that inspects Postgres catalogs moves to a db-postgres-only test file instead.

- [ ] **Step 4.1: Port audit + counters suites; parity check; keep catalog-level assertions in db-postgres.**
- [ ] **Step 4.2: Port admin-store suites behind `createAdminStore`; parity check.**
- [ ] **Step 4.3: Full workspace gate**

```bash
pnpm typecheck && pnpm test && cd packages/db-postgres && pnpm test:integration
```

Expected: all green, counts match pre-refactor.

- [ ] **Step 4.4: Commit**

```bash
git add -A && git commit -s -m "test(db-conformance): ported audit, counters and admin-store suites"
```

---

### Task 5: Phase 1 wrap — CI, changeset, PR

**Files:**
- Modify: `.github/workflows/ci.yml` — no matrix change yet (Postgres-only), but confirm the integration job picks up the conformance entry (it runs via the same `pnpm test:integration`).
- Create: changeset (patch/minor per current 4.x conventions) covering `@byline/core` and `@byline/db-postgres`: "moved dialect-independent storage machinery to core; added private adapter conformance suite; no behavioural change".
- Modify: `CLAUDE.md` + `docs/03-architecture/01-document-storage.md` — flatten/reconstruct file references now point at `packages/core/src/storage/*` (run `pnpm docs:check`).

- [ ] **Step 5.1: Docs + CLAUDE.md path updates; `pnpm docs:check` green.**
- [ ] **Step 5.2: Changeset; commit signed.**
- [ ] **Step 5.3: Push and open PR to `develop`** (title `refactor(core): adapter seam extraction and conformance suite`). CI green. **Phase 1 releases before Phase 2 begins.**

---

## Phase 2 — `@byline/db-mysql`

### Task 6: MySQL local-dev and test-database harness

**Files:**
- Create: `mysql/mysql.sh` — mirror of `postgres/postgres.sh` (up/down/logs) for the official `mysql:8` image (pinned minor ≥ 8.0.14; `--default-authentication-plugin` not needed on 8.x; `character-set-server=utf8mb4`, `collation-server=utf8mb4_0900_ai_ci`).
- Create: `mysql/docker-compose.yml` with a `byline` database + app user, port 3306, and a healthcheck.
- Create: `packages/db-mysql/src/database/db_init.sh` — creates `byline` and `byline_test` schemas and the app user with grants (mirrors the pg `db_init.sh` flow).
- Modify: root `package.json` — `db:init:test:mysql` convenience script.

**Interfaces:**
- Produces: env convention `BYLINE_MYSQL_DATABASE_URL` (e.g. `mysql://byline:byline@localhost:3306/byline`), `..._TEST` variant for the conformance run. `.env.example` files document both.

- [ ] **Step 6.1: Compose file + script; `./mysql/mysql.sh up -d`; verify `SELECT VERSION()` ≥ 8.0.14 via `docker exec`.**
- [ ] **Step 6.2: `db_init.sh` idempotent (re-run is a no-op).**
- [ ] **Step 6.3: Commit** (`chore(db-mysql): added mysql docker harness and db init scripts` — signed).

---

### Task 7: Package skeleton, pool, boot check, transaction plumbing

**Files:**
- Create: `packages/db-mysql/package.json` (mirror db-postgres: name `@byline/db-mysql`, MPL-2.0, exports `.`, `./admin`, `./schema`; deps: `@byline/core`, `@byline/auth`, `@byline/admin` (types for admin repos), `drizzle-orm`, `mysql2`, `uuid`; devDeps: `drizzle-kit`, `vitest`, `@byline/db-conformance`), `tsconfig.json`, `biome.jsonc`, `drizzle.config.ts` (`dialect: 'mysql'`), `vitest.config.ts` (node + integration modes, mirroring db-postgres).
- Create: `packages/db-mysql/src/lib/db-manager.ts` — duplicate of the pg `DBManagerImpl`/`TXManagerImpl` with mysql2 types and pinned isolation:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

import type { MySql2Database } from 'drizzle-orm/mysql2'

import type * as schema from '../database/schema/index.js'

export type DBExecutor = MySql2Database<typeof schema>

const transactionALS = new AsyncLocalStorage<DBExecutor>()

export class DBManagerImpl {
  constructor(private readonly deps: { dbPool: DBExecutor }) {}
  get(): DBExecutor {
    return transactionALS.getStore() ?? this.deps.dbPool
  }
}

export class TXManagerImpl {
  constructor(private readonly db: DBManagerImpl) {}
  withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db
      .get()
      .transaction((tx) => transactionALS.run(tx as unknown as DBExecutor, fn), {
        isolationLevel: 'read committed', // spec decision: match pg adapter assumptions
      })
  }
}
```

- Create: `packages/db-mysql/src/lib/boot-check.ts`:

```ts
const MIN = { major: 8, minor: 0, patch: 14 }

export async function assertMySqlVersion(query: (sql: string) => Promise<Array<{ v: string }>>) {
  const [{ v }] = await query('SELECT VERSION() AS v')
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  const [major = 0, minor = 0, patch = 0] = m ? m.slice(1).map(Number) : []
  const ok =
    major > MIN.major ||
    (major === MIN.major &&
      (minor > MIN.minor || (minor === MIN.minor && patch >= MIN.patch)))
  if (!ok) {
    throw new Error(
      `@byline/db-mysql requires MySQL ${MIN.major}.${MIN.minor}.${MIN.patch}+ (LATERAL joins); server reports ${v}. MariaDB is not supported.`
    )
  }
}
```

- Create: `packages/db-mysql/src/index.ts` — `mysqlAdapter({ connectionString, collections, defaultContentLocale, connectionLimit = 20 })` returning `MySqlAdapter extends IDbAdapter` with `drizzle` + `pool` exposed; mysql2 pool created with `timezone: 'Z'`, `decimalNumbers: false`; calls `assertMySqlVersion` on first connection (lazily, surfacing at `initBylineCore()` boot).
- Test: `packages/db-mysql/src/lib/boot-check.test.node.ts` (accepts 8.0.14/8.4/9.x; rejects 8.0.13, 5.7, MariaDB version strings like `11.4.2-MariaDB`).

**Interfaces:**
- Produces: `mysqlAdapter(opts): MySqlAdapter`; `DBManagerImpl` / `TXManagerImpl` / `DBExecutor` for Tasks 9–12.

- [ ] **Step 7.1: Write boot-check tests (fail), implement, pass.**
- [ ] **Step 7.2: Skeleton typechecks (`pnpm typecheck`); adapter factory returns a stub `IDbAdapter` throwing "not implemented" per method (replaced task by task).**
- [ ] **Step 7.3: Commit** (`feat(db-mysql): package skeleton, boot version check and transaction plumbing` — signed).

---

### Task 8: Schema and views (Drizzle mysql-core) + migration stream

**Files:**
- Create: `packages/db-mysql/src/database/schema/common.ts` — `timestamps` helpers on `datetime(3)`; the shared `uuidChar` custom type:

```ts
import { customType } from 'drizzle-orm/mysql-core'

/** CHAR(36) ascii_bin — canonical UUID text, byte-wise comparison. */
export const uuidChar = customType<{ data: string; driverData: string }>({
  dataType: () => 'char(36) CHARACTER SET ascii COLLATE ascii_bin',
})

/** ascii_bin varchar for byte-wise-sorted keys (order_key). */
export const varcharByteSorted = customType<{
  data: string
  driverData: string
  config: { length: number }
}>({
  dataType: (c) => `varchar(${c?.length ?? 255}) CHARACTER SET ascii COLLATE ascii_bin`,
})
```

- Create: `packages/db-mysql/src/database/schema/index.ts` — every table from the pg schema under the spec Section 2 type map. Load-bearing specifics:
  - all id / FK columns: `uuidChar`
  - `field_path`: `varchar(512)` (utf8mb4) — unique key `(document_version_id, field_path, locale)` ≈ 2,124 bytes < 3,072 InnoDB cap
  - `locale`: `varchar(10)`
  - `jsonb` → `json`; `boolean` → `boolean()` (mysql-core emits TINYINT(1)); `timestamptz` → `datetime(3)`; `decimal` keeps pg precision/scale; `order_key` → `varcharByteSorted(128)`
  - every index and unique constraint from the pg schema ports by name
- Create: the two views via `mysqlView` with the same `ROW_NUMBER()` bodies (`byline_current_documents`, `byline_current_published_documents`) including the `byline_documents` join projecting `order_key` / `source_locale`.
- Create: `packages/db-mysql/src/database/schema/auth.ts` — admin tables under the same map.
- Create: Drizzle migration stream: `pnpm drizzle:generate` output under `src/database/migrations/`.
- Create: `packages/db-mysql/sql/README.md` — hand-written-stream conventions (numbered, idempotent, transactional); notes there is no MySQL ownership-guard equivalent; stream starts empty.
- Test: `packages/db-mysql/src/database/schema/schema-pins.test.node.ts` — pins: every unique key's byte budget ≤ 3072 (compute from column defs), `order_key`/id collations are `ascii_bin`, timestamp columns are `datetime(3)`.

- [ ] **Step 8.1: Write schema-pin tests first (fail on empty schema).**
- [ ] **Step 8.2: Port tables + views; `drizzle:generate`; apply to the docker DB; pins pass.**
- [ ] **Step 8.3: Verify the views return window-function results on seeded rows (manual `docker exec mysql … -e 'SELECT …'` smoke).**
- [ ] **Step 8.4: Commit** (`feat(db-mysql): schema, current-document views and migration stream` — signed).

---

### Task 9: Storage commands port (writes)

**Files:**
- Create: `packages/db-mysql/src/modules/storage/storage-insert.ts`, `storage-commands.ts` — ported from the pg counterparts (2,528-line queries file is Task 10; commands are 1,633 lines + 200 insert). Normative conversions (spec Section 2 table):
  - `ON CONFLICT (document_version_id, field_path, locale) DO NOTHING` → `INSERT … ON DUPLICATE KEY UPDATE id = id` (7 sites in copy-forward)
  - `onConflictDoUpdate` (path upsert) → `ON DUPLICATE KEY UPDATE`
  - `.returning()` → construct-in-JS (ids are app-side UUIDv7; timestamps re-`SELECT` only where a later read needs DB defaults)
  - `FOR UPDATE` / `FOR UPDATE OF` in tree mutation + system-field locked reads → unchanged syntax
  - `::uuid` casts → dropped
- Create: `packages/db-mysql/src/modules/storage/normalize-row.ts` — the mysql2 canonicalisation (tinyint(1)→boolean for `boolean_value`, `thumbnail_generated`, `cascade_delete`; DECIMAL stays string; `JSON` columns parsed by driver; `DATETIME(3)`→Date verified).

**Interfaces:**
- Consumes: shared `flattenFieldSetData`, `storeColumnManifest`, `storeTableNames` from `@byline/core`; `DBManagerImpl` from Task 7.
- Produces: `createCommandBuilders(dbManager, defaultContentLocale)` with the same shape as pg (`documents`, `collections` command groups implementing `IDocumentCommands` / `ICollectionCommands`).

- [ ] **Step 9.1: Port `storage-insert.ts`; wire a minimal `createDocumentVersion`; run the conformance versioning + flatten-reconstruct suites only (vitest `-t` filter) against MySQL — expected: those files PASS.**
- [ ] **Step 9.2: Port the remaining command surface (paths, available-locales, status, archive, soft-delete, delete-locale, order-key, tree mutations) suite-by-suite, running the matching conformance file after each.**
- [ ] **Step 9.3: Commit per green suite group** (`feat(db-mysql): storage write commands` — signed; split commits at natural boundaries).

---

### Task 10: Storage queries port (reads)

**Files:**
- Create: `packages/db-mysql/src/modules/storage/storage-store-manifest.ts` — `storeSelectList()` generating the UNION ALL from the shared manifest with `mysqlNullCast` (`'uuid'` → `CAST(NULL AS CHAR(36))`, `'boolean'` → `CAST(NULL AS SIGNED)`, `'timestamptz'` → `CAST(NULL AS DATETIME(3))`, `'jsonb'` → `CAST(NULL AS JSON)`, `'text'` → `CAST(NULL AS CHAR)`, numeric kinds likewise).
- Create: `packages/db-mysql/src/modules/storage/storage-queries.ts` — port of the 2,528-line pg file. Normative conversions:
  - locale-chain: `ANY(ARRAY[...])` + `array_position(...)` → `IN (…)` + `ORDER BY FIELD(locale, …)` (2 path-resolution sites + the store-row locale condition)
  - `ILIKE` → `LIKE` (utf8mb4_0900_ai_ci; documented accent-insensitivity divergence)
  - `LEFT JOIN LATERAL` field-sort → unchanged syntax (floor guarantees support)
  - `WITH RECURSIVE` ancestors/subtree → unchanged syntax; `order_key::text` cast dropped (already CHAR-family)
  - `count(*)::int` → `CAST(COUNT(*) AS SIGNED)`; JS `Number()` normalisation at the result edge
  - all rows through `normalizeRow` before `extractFlattenedFieldValue`
- Create: `packages/db-mysql/src/modules/storage/storage-utils.ts` — `getFirstOrThrow` mysql2 variant.

**Interfaces:**
- Produces: `createQueryBuilders(db, collections, defaultContentLocale, dbManager)` implementing `IDocumentQueries` / `ICollectionQueries` (same factory shape as pg).

- [ ] **Step 10.1: UNION ALL + `getDocumentById` first; conformance flatten-reconstruct + field-types suites green on MySQL.**
- [ ] **Step 10.2: `findDocuments` (filters, combinators, relation hops, doc-column filters, LATERAL sort, pagination, `query` LIKE search); locale fallback; paths; trees; history; the remaining query surface — suite-by-suite as in Task 9.**
- [ ] **Step 10.3: Full storage conformance run green on MySQL:**

```bash
cd packages/db-mysql && pnpm test:integration
```

- [ ] **Step 10.4: Commit** (`feat(db-mysql): storage read queries and unified union projection` — signed).

---

### Task 11: Counters and audit

**Files:**
- Create: `packages/db-mysql/src/modules/counters/counters-commands.ts`:

```ts
// nextCounterValue — atomic, single round trip, pool connection (never the
// ambient transaction: a long doc-create tx would serialise the group).
// 0 affected rows ⇒ unregistered group ⇒ throw (contract honesty).
const [result] = await pool.execute(
  'UPDATE byline_counter_groups SET current_value = LAST_INSERT_ID(current_value + 1) WHERE group_name = ?',
  [groupName]
)
if ((result as ResultSetHeader).affectedRows === 0) {
  throw new Error(`nextCounterValue: counter group "${groupName}" is not registered`)
}
const [[{ v }]] = await pool.query('SELECT LAST_INSERT_ID() AS v')  // same connection — use pool.getConnection() around both statements
return Number(v)
```

  (Implementation note baked into the task: both statements MUST run on one checked-out connection — `LAST_INSERT_ID()` is per-connection. `ensureCounterGroup`: `INSERT INTO byline_counter_groups (group_name, current_value) VALUES (?, 0) ON DUPLICATE KEY UPDATE group_name = group_name`; returns `sequenceName: 'byline_counter_groups:' + groupName`. `nextScopedCounterValue`: single `INSERT … ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)` on `byline_counter_scopes` with `VALUES` seed `LAST_INSERT_ID(1)` semantics — insert path returns 1.)
- Create: `packages/db-mysql/src/modules/audit/audit-commands.ts`, `audit-queries.ts` — mechanical port (UUIDv7 app-side ids; the two-source UNION feed in `findAuditLog` ports with `CAST` adjustments; runs on `DBManager` so appends join ambient transactions, reads on pool — same split as pg).

- [ ] **Step 11.1: Counters conformance suite green on MySQL (monotonic, gap-tolerant, unknown-group throws, scoped self-registration, concurrency smoke: 20 parallel `nextCounterValue` yield 20 distinct values).**
- [ ] **Step 11.2: Audit suites green (atomicity with `withTransaction` covered by the ported transactions suite).**
- [ ] **Step 11.3: Commit** (`feat(db-mysql): table-emulated counters and audit log` — signed).

---

### Task 12: Admin repositories (`@byline/db-mysql/admin`)

**Files:**
- Create: `packages/db-mysql/src/modules/admin/` — port of the six pg files (`admin-users-repository.ts`, `admin-roles-repository.ts`, `admin-permissions-repository.ts`, `refresh-tokens-repository.ts`, `admin-preferences-repository.ts`, `admin-store.ts`, `index.ts`) against the interfaces from `@byline/admin`. The 11 `.returning()` sites → construct-in-JS; preferences upsert → `ON DUPLICATE KEY UPDATE`; `jsonb` value columns → `json`.
- Modify: `packages/db-mysql/package.json` — `./admin` subpath export (types + import), matching db-postgres's export shape (top-level AND `publishConfig.exports` if that pattern applies — check `exports-parity` conventions in the repo).

- [ ] **Step 12.1: Admin-store conformance suites (via `createAdminStore` hook) green on MySQL.**
- [ ] **Step 12.2: Commit** (`feat(db-mysql): admin store repositories` — signed).

---

### Task 13: Full conformance + dialect pins + end-to-end boot

**Files:**
- Create: `packages/db-mysql/tests/conformance.integration.test.ts` — full `runAdapterConformanceSuite` + `createAdminStore` wiring (migrate via drizzle-kit programmatic API or a `migrate()` helper; truncate helper mirrors pg's).
- Create: `packages/db-mysql/src/modules/storage/dialect-pins.integration.test.ts` — MySQL-specific pins: `order_key` DB sort order matches JS string sort on the `generateKeyBetween` alphabet; `ascii_bin` id equality is case-sensitive; DATETIME(3) UTC round-trip (write Date, read identical ms); DECIMAL returns string; LIKE case-insensitivity smoke.
- Verify (no file): `apps/webapp` boots against `mysqlAdapter` by swapping the adapter in a local `byline/server.config.ts` variant — admin login, create/edit/publish a `docs` document, list views, trees, history all function. This is a manual smoke gate, recorded in the PR description.

- [ ] **Step 13.1: Full integration run green:** `cd packages/db-mysql && pnpm test:integration` — same suite count as db-postgres's conformance run (admin + storage + audit + counters).
- [ ] **Step 13.2: Dialect pins green.**
- [ ] **Step 13.3: Manual webapp smoke on MySQL; note results in PR.**
- [ ] **Step 13.4: Commit** (`test(db-mysql): full conformance wiring and dialect pins` — signed).

---

### Task 14: CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml` — add a `mysql:8` service container (health-checked) beside Postgres; run `packages/db-mysql` integration tests with `BYLINE_MYSQL_DATABASE_URL` pointing at it. Keep the jobs parallel (separate matrix entries or separate jobs) so a MySQL failure is immediately attributable.

- [ ] **Step 14.1: Workflow change; green run on the PR branch.**
- [ ] **Step 14.2: Commit** (`ci: added mysql service container and db-mysql integration job` — signed).

---

### Task 15: Docs, changeset, release, follow-up issues

**Files:**
- Modify: `docs/03-architecture/01-document-storage.md` — a short "Adapters" note: two adapters, shared machinery in core, conformance suite as the contract instrument.
- Create: `packages/db-mysql/README.md` — install, `mysqlAdapter` usage, engine floor, UUID/timestamp conventions, counters emulation note, "no search provider yet" pointer.
- Create: changeset — minor release: new `@byline/db-mysql` package, lockstep with the workspace.
- Create (GitHub, not files): follow-up issues from spec Section 5 — `@byline/search-mysql` (InnoDB FULLTEXT provider), MySQL storage-benchmark target (GA gate: measure the view-materialisation question), MariaDB support (on demand).

- [ ] **Step 15.1: Docs (`pnpm docs:check` green) + README.**
- [ ] **Step 15.2: Changeset; commit signed; push; PR to `develop`.**
- [ ] **Step 15.3: File the three follow-up issues with `area:` labels, linking the spec.**

---

## Self-review record

- **Spec coverage:** Section 1 → Tasks 1–5; Section 2 → Tasks 7, 8, 10; Section 3 → Tasks 9, 11, 12 (+ Task 6 tooling, Task 8 `sql/README.md`); Section 4 → Tasks 13, 14 (+ unit-test gain in Task 1); Section 5 → Task 15. Risks: view materialisation → Task 15 benchmark issue (GA gate); index-key budget → Task 8 pin test; isolation → Task 7 `TXManagerImpl`; conformance fidelity → Tasks 3–4 parity gates.
- **Known intentional deviation from bite-sized-code granularity:** Tasks 9, 10, 12 are mechanical ports specified by source file + normative conversion table + per-suite verification rather than inline code listings (rationale in the plan header note).
