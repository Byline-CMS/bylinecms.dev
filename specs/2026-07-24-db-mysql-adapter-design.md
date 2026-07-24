# MySQL database adapter (`@byline/db-mysql`) — design

Date: 2026-07-24
Issues: to be created from this spec (see companion plan)
Status: approved in brainstorming with Tony, 2026-07-24
Companions:
- `specs/2026-07-24-db-mysql-adapter-plan.md` — the phased implementation plan.
- `specs/2026-07-24-drizzle-free-adapters-analysis.md` — the parallel analysis of what both RDBMS adapters would look like without Drizzle (native DDL + SQL).

## Purpose

Byline currently has one database adapter, `@byline/db-postgres` (~8,600 lines of
non-test source). This design covers the second adapter, `@byline/db-mysql`, with two
deliberate goals in tension-free order:

1. **Seam hardening first.** Building a second adapter is the forcing function that
   proves the `IDbAdapter` contract and flushes out any Postgres assumptions that
   have leaked above the adapter boundary. Phase 1 therefore extracts the
   dialect-independent storage machinery into `@byline/core` and turns the existing
   adapter integration tests into a reusable conformance suite — with `@byline/db-postgres`
   passing it unchanged in behaviour — before any MySQL code exists.
2. **Then ship.** Phase 2 builds `@byline/db-mysql` against the proven contract and
   conformance suite. A third adapter (SQLite is the obvious candidate) becomes cheap.

Drizzle ORM remains the development-time schema-management, generation, and migration
tool for both adapters (the decision to keep or replace it is analysed separately in
the companion analysis document — it is explicitly not part of this design).

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Engine scope | **MySQL 8.0.14+ (InnoDB only)**. Enforced with a boot-time `SELECT VERSION()` check that fails fast with a clear error. MariaDB explicitly out of scope for v1 (no LATERAL join support) — revisit on demand |
| Surface scope | Core `IDbAdapter` (documents, collections, counters, audit, transactions) **plus** the admin-store repositories (`@byline/db-mysql/admin`), so the admin UI runs on MySQL. Search deferred: `@byline/search-mysql` (InnoDB FULLTEXT) is a named follow-up |
| UUID storage | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`. Ids stay plain strings end-to-end; the ~100 raw SQL fragments port mechanically; UUIDv7's canonical text form preserves time-ordering, so `ORDER BY id DESC` version resolution works unchanged. Cost accepted: ~2.25× larger id indexes than `BINARY(16)` |
| Shared-code home | Dialect-independent EAV machinery moves into `@byline/core` (`packages/core/src/storage/`), joining `field-store-map.ts`. No new published package (Approach A) |
| Conformance suite | New **private, unpublished** workspace package `packages/db-conformance` exposing the behavioural test suite parameterised over an `IDbAdapter` factory |
| Transaction plumbing | `DBManagerImpl` / `TXManagerImpl` (~90 lines) are **duplicated** per adapter, not shared — they are small and driver-typed; genericising over two Drizzle dialect types buys nothing behavioural |
| Isolation level | The MySQL adapter opens transactions at **READ COMMITTED** explicitly (MySQL's default is REPEATABLE READ), so locking behaviour matches the Postgres adapter's assumptions and avoids gap-lock surprises |
| Counters | Table-emulated sequences via the `LAST_INSERT_ID(expr)` atomic-increment idiom (MySQL has no `CREATE SEQUENCE`) |
| Timestamps | `DATETIME(3)`, UTC by convention (pool `timezone: 'Z'`). `TIMESTAMP` rejected (2038 range limit) |
| Drizzle-free analysis | Separate recommendation-grade document; not a committed phase |

## Section 1 — shared-code extraction (Phase 1, behaviour-preserving)

### What moves to `@byline/core`

A new module directory `packages/core/src/storage/` (joining the existing
`field-store-map.ts`) receives, from `packages/db-postgres/src/modules/storage/`:

- **`flattenFieldSetData()`** and its generator helpers (`storage-flatten.ts`) — the
  schema walk that turns a document tree into `FlattenedFieldValue[]`. Already pure:
  schema + data + locale in, plain values out. No Drizzle, no SQL.
- **`restoreFieldSetData()`**, `restoreFieldData`, and `extractFlattenedFieldValue`
  (`storage-restore.ts`) — the inverse walk. Also pure.
- **The row types** (`storage/@types.ts`): `FlattenedFieldValue` and, most importantly,
  **`UnifiedFieldValue`** — which is promoted to the formal, documented canonical row
  shape at the adapter boundary (see "The `UnifiedFieldValue` seam" below).
- **The store-manifest column data** (`storage-store-manifest.ts`): the declarative
  `ColumnDef[]` manifest (column name, null-cast type, per-store source expressions)
  and `storeTableNames`. The manifest is data; only the SQL *generation* from it
  (`storeSelectList()`, which emits Drizzle `SQL` fragments) stays per-adapter.
  The per-store source expressions in the shared manifest are restricted to plain
  column names (they already are); any dialect-specific cast syntax lives in the
  adapter's generator.
- **`resolveStoreTypes()`** (`storage-utils.ts`) — selective-field-loading store
  resolution; already operates on `FieldSet` + field names only.

`@byline/db-postgres` then imports these from `@byline/core` (it already imports
`fieldTypeToStore` / `fieldTypeToStoreType` / `ALL_STORE_TYPES` from there — this
extraction completes a move that is half-done by design).

### The `UnifiedFieldValue` seam

`restoreFieldSetData` consumes `FlattenedFieldValue[]`, produced from raw UNION ALL
rows via `extractFlattenedFieldValue(row: UnifiedFieldValue)`. Today the Postgres
adapter's driver rows happen to match `UnifiedFieldValue` structurally. The extraction
formalises this: **each adapter owns a `normalizeRow(driverRow): UnifiedFieldValue`
step** that runs before any shared code sees a row. This is where driver variance is
absorbed:

- pg: current behaviour is codified as the reference (e.g. `BIGINT` `file_size`
  arriving as a string — already tolerated by `UnifiedFieldValue`'s
  `number | string | null` type).
- mysql2: `TINYINT(1)` → boolean, `DECIMAL` → string (matching pg's `numeric`
  behaviour), `DATETIME(3)` → `Date` (mysql2 does this natively when `dateStrings`
  is off), `JSON` → parsed object.

The seam is a **normalisation contract, not an abstraction layer**: adapters still
write their own SQL; they just promise that rows handed to shared restore code are
canonical.

### What stays in each adapter

Drizzle schema definitions, all SQL (queries and commands), the two views, the
`DBManager`/`TXManager` pair, counters, audit, admin repositories, the migration
streams (Drizzle + hand-written `sql/`), and the test-database harness.

### `packages/db-conformance` (private workspace package)

Exports `runAdapterConformanceSuite(hooks)` where:

```ts
interface ConformanceHooks {
  createAdapter(collections: readonly CollectionDefinition[]): Promise<IDbAdapter>
  migrate(): Promise<void>      // bring the test DB to current schema
  truncate(): Promise<void>     // between-file isolation, same policy as today
  teardown(): Promise<void>
}
```

The suite body is the existing behavioural test corpus, refactored to receive the
adapter by injection instead of importing `pgAdapter`:

- the 14 storage test files under `packages/db-postgres/src/modules/storage/tests/`
  (versioning, flatten/reconstruct round-trip, field types, locale fallback, paths,
  trees + tree audit, transactions, delete-locale, available-locales, system-field
  direct writes, multi-relation, store manifest, restore),
- the audit and counters module tests,
- the admin repository tests (parameterised over the `AdminStore` factory).

Each adapter package keeps a thin integration-test entry that instantiates the suite
with its own hooks. **Phase 1 gate:** `@byline/db-postgres` passes the extracted suite
with zero behavioural diffs, and the per-module test files are *replaced by* (not
duplicated alongside) the conformance suite. Tests that pin genuinely
Postgres-specific behaviour (e.g. the `sql/` ownership-guard CI test) stay in
`db-postgres`.

Phase 1 ships as a normal core + db-postgres refactor release **before any MySQL code
exists**, so regressions (if any) surface in the production adapter while attention is
on it.

## Section 2 — `@byline/db-mysql` schema and dialect mapping

### Package shape

Mirrors `@byline/db-postgres` exactly:

```ts
mysqlAdapter({
  connectionString,            // mysql2 URI, or discrete pool options
  collections,
  defaultContentLocale,
  connectionLimit = 20,        // mysql2 pool naming
}): MySqlAdapter               // extends IDbAdapter
```

`MySqlAdapter` exposes `drizzle` (via `drizzle-orm/mysql2`) and `pool`
(`mysql2/promise` Pool) for housekeeping, session-provider, and migration tooling —
same rationale as `PgAdapter`. Subpath exports: `.`, `./admin`, `./schema`. The
maintenance surface (`backfillSourceLocales` from the core contract,
`reAnchorDocument` / `reAnchorDocuments`) ports; `backfillVersionLocales` is
implemented as the contract requires but is a structural no-op on fresh installs
(no pre-ledger MySQL data can exist).

Boot check: the adapter's first connection verifies `VERSION()` ≥ 8.0.14 and errors
with a message naming the floor and the reason (LATERAL joins).

### Type mapping

| Postgres | MySQL | Notes |
|---|---|---|
| `uuid` | `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin` | Decided above. All ids app-generated UUIDv7 |
| `jsonb` | `JSON` | mysql2 parses on read. The adapter uses no jsonb *operators* in SQL today (JSON values are opaque payloads), so parity is trivial |
| `timestamptz` | `DATETIME(3)` | UTC by convention: pool `timezone: 'Z'`; all writes/reads UTC |
| `text` (unindexed) | `TEXT` | |
| `text` / `varchar` (indexed) | `VARCHAR(n)` with explicit length | InnoDB unique-index key cap is 3072 bytes; utf8mb4 costs 4 bytes/char. `field_path` is pinned at `VARCHAR(512)` utf8mb4 — with `CHAR(36)` ascii id + `VARCHAR(10)` locale, the store tables' `(document_version_id, field_path, locale)` unique key totals ≈ 2,124 bytes < 3,072 |
| `varchar(...) COLLATE "C"` (`order_key`) | `VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin` | Byte-wise ordering preserved — the fractional-index invariant (`generateKeyBetween` agrees with DB sort) holds |
| `boolean` | `TINYINT(1)` | Normalised to boolean in `normalizeRow` |
| `real` | `FLOAT` / `DOUBLE` | Match current precision choices column-by-column |
| `decimal` | `DECIMAL` (same precision) | mysql2 `decimalNumbers` stays **off**; decimals arrive as strings, matching pg `numeric` |
| `bigint` | `BIGINT` | Arrives as string above `Number.MAX_SAFE_INTEGER` handling threshold — normalised the same way pg's is |
| `date` / `time` | `DATE` / `TIME(3)` | |

### Views

Both `byline_current_documents` and `byline_current_published_documents` port
structurally as-is — MySQL 8 supports window functions in views — declared via
Drizzle `mysqlView` with the same `ROW_NUMBER() OVER (PARTITION BY document_id ORDER
BY id DESC)` body and the `byline_documents` join for `order_key` / `source_locale`.

**Pinned caveat:** MySQL's optimiser cannot always merge a view containing window
functions into the outer query and may materialise it into a temp table per
reference. Correctness is unaffected (the conformance suite is the gate); the
*performance* question is measured, not assumed: the storage benchmark harness gains
a MySQL target before GA, and if view materialisation shows up in the numbers, the
mitigation is inlining the version-resolution derived table into the hot queries
(the SQL is generated in one place per query site, so this is contained).

### SQL construct equivalents

| Postgres construct | MySQL 8.0.14+ equivalent | Sites |
|---|---|---|
| `LEFT JOIN LATERAL` | Supported as-is | field-level sort in `findDocuments` |
| `WITH RECURSIVE` | Supported as-is | `getTreeAncestors`, `getTreeSubtree` |
| `ROW_NUMBER() OVER` | Supported as-is | both views, history pagination |
| `ILIKE` | `LIKE` under `utf8mb4_0900_ai_ci` | list-view `query` search. Case-insensitive; **also accent-insensitive** — a documented, accepted divergence |
| `ANY(ARRAY[...])` + `array_position(...)` | `IN (...)` + `FIELD(locale, ...)` | locale-chain resolution in path lookup and locale fallback |
| `::uuid` / `::int` / `::text` casts | Dropped (uuid is `CHAR(36)`) or `CAST(... AS ...)` | pervasive, mechanical |
| `ON CONFLICT (...) DO NOTHING` | `INSERT ... ON DUPLICATE KEY UPDATE id = id` | store-row copy-forward, meta upserts. **Never `INSERT IGNORE`** — it swallows unrelated errors (data truncation, FK) |
| `ON CONFLICT ... DO UPDATE` | `ON DUPLICATE KEY UPDATE ...` | path upsert, preferences upsert |
| `RETURNING` (15 sites, 11 in admin repos) | Construct the return object in JS (all ids are app-generated UUIDv7); re-`SELECT` only where the row carries DB-generated values (timestamp defaults) | commands + admin repos |
| `FOR UPDATE` / `FOR UPDATE OF` | Supported as-is | tree mutation guards, system-field locked reads |
| `count(*)::int` | `CAST(COUNT(*) AS SIGNED)` + JS normalisation | pagination totals |
| `COLLATE "C"` | `ascii_bin` column collation | `order_key` |
| Partial indexes | Not used by the Postgres adapter — nothing to port | — |

## Section 3 — counters, transactions, and the remaining hard parts

### Counters (the one real design divergence)

MySQL has no `CREATE SEQUENCE`. The MySQL adapter emulates the `ICounterCommands`
contract with value columns on the registry tables and the classic atomic-increment
idiom:

- `byline_counter_groups` gains `current_value BIGINT NOT NULL DEFAULT 0`; a new
  `byline_counter_scopes` table (`scope_name` PK, `current_value`) backs
  `nextScopedCounterValue`.
- `nextCounterValue(group)`:
  `UPDATE byline_counter_groups SET current_value = LAST_INSERT_ID(current_value + 1) WHERE group_name = ?`,
  then read `LAST_INSERT_ID()` on the same connection. Atomic, one round trip.
  Unknown group ⇒ 0 affected rows ⇒ throw, preserving the contract's
  "unregistered group is a configuration error" honesty.
- `nextScopedCounterValue(scope)`: `INSERT ... ON DUPLICATE KEY UPDATE
  current_value = LAST_INSERT_ID(current_value + 1)` — the idempotent
  ensure-then-allocate in one statement (`LAST_INSERT_ID(expr)` in the insert path
  seeds value 1).
- **Runs on the pool, not the ambient transaction** — mirroring the Postgres
  adapter, where counters deliberately use the raw `db`. Otherwise a long
  document-create transaction would hold the counter row lock and serialise all
  creates in that group. Gaps on rollback are already contractual
  ("gaps are expected").
- `ensureCounterGroup` becomes a single `INSERT ... ON DUPLICATE KEY UPDATE
  group_name = group_name` — race-safe idempotency without Postgres's two-phase
  catalog-lock sequencing (that comment block does not apply). The returned
  `sequenceName` reports the emulation row's identity (e.g.
  `byline_counter_groups:<group>`), since no DB sequence object exists.

### Transactions

`DBManagerImpl` / `TXManagerImpl` are duplicated with `MySql2Database` types; the
AsyncLocalStorage propagation design (docs/03-architecture/03-transactions.md) carries over
verbatim. Drizzle's mysql2 driver supports nested `.transaction()` via SAVEPOINT, so
`withTransaction` nesting semantics are unchanged. The adapter opens transactions at
READ COMMITTED explicitly (see decision table).

### Admin repositories (`@byline/db-mysql/admin`)

Port of the five repositories (users, roles, permissions, refresh tokens,
preferences) against the same interfaces from `@byline/admin`. Schema ports
mechanically under the type map; the 11 `.returning()` sites become
construct-in-JS. Argon2id hashing, JWT session logic, and all command/service code
live upstream in `@byline/admin` and are untouched — the repositories are the whole
port surface.

### Migrations and tooling

- Drizzle stream: `drizzle-kit` with `dialect: 'mysql'`, own migration folder,
  `drizzle:generate` / `drizzle:migrate` scripts mirroring db-postgres.
- Hand-written `sql/` stream: starts **empty** (no deployed MySQL databases exist).
  Its README documents the numbered-idempotent-transactional convention from day
  one. The Postgres ownership guard has no MySQL equivalent (MySQL has no
  role-ownership model for tables) — noted in that README, not ported.
- Local dev: `mysql/mysql.sh` Docker compose script mirroring `postgres/postgres.sh`
  (MySQL 8 official image), plus `db_init.sh` for database + app-user creation and a
  test-database variant for the conformance suite.

## Section 4 — testing and CI

- **The conformance suite is the primary correctness instrument** (Section 1).
  db-mysql runs it against a `byline_test` MySQL database with the same per-file
  truncation isolation db-postgres uses today.
- **CI**: `.github/workflows/ci.yml` gains a MySQL 8 service container beside the
  Postgres one; the integration job runs the conformance suite once per adapter.
- **Unit-test gain**: flatten/restore round-trip and manifest tests move to
  `@byline/core`'s fast, DB-free suite.
- **Dialect pins**: the adapter-independent contract tests
  (`storage-paths.test.node.ts`, `field-store-map.test.node.ts`) stay green
  untouched. db-mysql adds its own pins for the choices in this spec:
  `order_key` byte-wise sort order, `ascii_bin` id equality semantics, DATETIME
  UTC round-trip, DECIMAL-as-string normalisation.
- **Benchmarks**: `benchmarks/storage` gains a MySQL target as a follow-up, not a
  v1 gate — but the Section 2 view-materialisation question must be measured
  before GA.

## Section 5 — out of scope (named follow-ups)

| Item | Why deferred | Where tracked |
|---|---|---|
| `@byline/search-mysql` (InnoDB FULLTEXT `SearchProvider`) | Search is a separate pluggable seam; a MySQL install is fully usable without it (search UI degrades / is disabled) | Follow-up issue from this spec |
| MariaDB support | No LATERAL joins; requires a correlated-subquery rewrite of the field-sort path and dual-engine CI | Revisit on demand |
| `BINARY(16)` UUID storage | Rejected for v1 (porting hazard across ~100 raw SQL fragments); switching later is a full-table rewrite, so this is effectively permanent for MySQL installs created on v1 | Decision recorded here |
| MySQL storage benchmark target | Follow-up immediately after the adapter lands; gates GA, not the first release | Companion plan, Phase 2 tail |
| Drizzle-free native-SQL adapters | Separate analysis | `specs/2026-07-24-drizzle-free-adapters-analysis.md` |

## Risks

1. **View materialisation performance** (Section 2) — measured before GA; contained
   mitigation (inline the derived table).
2. **Accent-insensitive `LIKE`** — behavioural divergence from pg `ILIKE`;
   documented; affects only the admin list-view quick search.
3. **REPEATABLE READ leakage** — any code path that opens a transaction outside
   `withTransaction` would get MySQL's default isolation; the adapter routes all
   transaction opening through `TXManagerImpl`, which sets READ COMMITTED.
4. **utf8mb4 index-key budget** — pinned lengths (`field_path` 512) are asserted by
   a schema test so a future column addition to the unique key cannot silently
   exceed 3,072 bytes.
5. **Conformance-suite extraction fidelity** — the Phase 1 gate (db-postgres passes
   with zero diffs, old tests deleted only after parity) is the control.
