# Drizzle-free database adapters (native DDL + SQL) — analysis

Date: 2026-07-24
Status: recommendation-grade analysis, approved in brainstorming with Tony, 2026-07-24
Related: `specs/2026-07-24-db-mysql-adapter-design.md` (the MySQL adapter design this
analysis runs parallel to — that design **keeps** Drizzle; this document evaluates
dropping it as a possible later phase)

## Question

What would `@byline/db-postgres` and the future `@byline/db-mysql` look like if they
used no ORM — hand-written DDL for schema, a small in-repo migration runner, and
native SQL for every query — and should Byline do it?

## What Drizzle actually provides today

An honest inventory, concern by concern, measured against the current
`@byline/db-postgres` codebase:

### 1. Schema DSL (`pgTable`, `pgView`, column types)

`src/database/schema/index.ts` (879 lines) + `auth.ts` (255 lines). This is the
source of truth for **development-time** migration generation and for the table
objects the query builder references. It also carries two things plain DDL would
carry more directly: the `COLLATE "C"` custom type (already expressed as a raw SQL
string inside `customType`) and the two window-function views (expressed in Drizzle's
query-builder dialect, which is *harder* to read than the equivalent CREATE VIEW —
the hand-written `sql/0001` migration contains the same views as plain SQL, and it is
clearer).

### 2. Migration generation and running (`drizzle-kit generate` / `migrate`)

Used for development databases. **Production already does not use it**: the
`sql/` README is explicit that after a release squash the Drizzle journal no longer
matches deployed databases, and the hand-written numbered `sql/` scripts are the
production upgrade path. `@byline/search-postgres` goes further and owns a complete
in-repo precedent for the alternative: numbered SQL files + a ~50-line `migrate(pool)`
runner with its own `byline_search_migrations` ledger table.

So Drizzle's migration value today is: `drizzle-kit generate` diffs the schema DSL to
produce development migrations, and `drizzle:migrate` applies them to dev/test
databases. That is real value (schema diffing is genuinely tedious by hand) but it is
a **development convenience, not a production dependency**.

### 3. Query builder

Mixed usage. The storage module's hot paths (`storage-queries.ts`,
`storage-commands.ts` — ~4,160 lines, the bulk of the adapter) are dominated by raw
``sql`...` `` template fragments with Drizzle providing parameter binding and
composition; the query *builder* (`.select().from().where()`) appears mostly at the
edges. The admin repositories (~750 lines) are the opposite: idiomatic query-builder
code throughout. The two views are query-builder-defined.

### 4. Parameterised SQL composition (the ``sql`...` `` tag)

This is the piece the codebase actually leans on hardest — safe interpolation,
fragment composition (`sql.join`, nested fragments), and identifier handling across
~100 call sites. Losing Drizzle means replacing this, not just the query builder.

### 5. Transactions and savepoints

`db.transaction(fn)` with automatic SAVEPOINT nesting — consumed by
`TXManagerImpl` (~10 lines of actual usage). Trivially replaceable per driver
(`BEGIN`/`COMMIT`/`ROLLBACK` + savepoint counter), but it is correctness-critical
code Byline would then own.

### 6. Row type inference

`NodePgDatabase<typeof schema>` gives typed rows from builder queries. Raw
``sql`...` `` fragments already bypass this (results are cast), so the storage module
gets little of this value today; the admin repositories get a lot.

## What the native replacement looks like

Per concern, assuming both adapters go native together (the symmetric end-state):

| Concern | Native replacement | Size/shape |
|---|---|---|
| Schema | One canonical DDL file per adapter (`schema.sql`), the squashed current state — exactly what `sql/0001` already is for Postgres | Exists in embryo today |
| Migrations | Generalise the `@byline/search-postgres` pattern: numbered SQL + a shared ~100-line runner (per-adapter ledger table, transactional, idempotent-friendly). Dev and prod converge on **one** migration stream, eliminating the current two-stream split (a simplification, not a loss) | Small, proven in-repo |
| SQL tag | A ~150-line tagged-template helper per driver family: `sql\`...\`` producing `{ text, values }` with `$n` (pg) / `?` (mysql2) placeholders, fragment nesting, `sql.join`, identifier escaping. Or adopt a micro-library (e.g. the pg-template-tag family) — but owning 150 audited lines beats a dependency this central | The real engineering artefact of the migration |
| Query builder call sites | Storage module: mechanical — the fragments are already SQL. Admin repositories: a genuine rewrite of ~750 lines of builder code into SQL functions, plus hand-declared row types | The bulk of the effort |
| Transactions | Driver-native `BEGIN`/`COMMIT` + savepoint depth counter inside `TXManagerImpl`; ALS design unchanged | ~60 lines per adapter |
| Row types | Hand-declared interfaces per query (the storage module largely does this already via `UnifiedFieldValue` and friends) | Ongoing discipline cost |

## Costs

- **The admin-repository rewrite** is the largest single item — it is the code that
  uses Drizzle idiomatically and would need full re-testing (mitigated: the
  conformance suite from the MySQL design covers exactly this surface).
- **Losing `drizzle-kit generate`**: schema changes require hand-written migrations
  in dev too. In practice Byline's schema changes are rare and deliberate
  (EAV means most product changes need *no* schema change — that is the
  architecture's selling point), which blunts this cost considerably.
- **Owning correctness-critical plumbing**: the SQL tag and savepoint management
  become Byline code with Byline bugs. One-time audit + property tests.
- **Timing risk**: doing this *while* building db-mysql doubles the variables in
  every port decision.

## Benefits

- **One migration stream instead of two.** The Drizzle-journal-vs-`sql/` split (with
  its squash-drift problem, README warnings, and ownership-guard machinery) exists
  *because* of the dual system. Native-only dissolves it.
- **Dependency surface**: `drizzle-orm` + `drizzle-kit` leave the runtime and
  toolchain; version-churn exposure (Drizzle moves fast) disappears from a package
  that sits under every Byline installation.
- **Full SQL control and readability** where the adapter is most Postgres/MySQL
  specific — the views, the UNION ALL, the tree CTEs are already clearer in the
  `sql/` files than in builder form.
- **Symmetry with reality**: production migration is already native; search-postgres
  is already native; the storage hot paths are already ~raw SQL. Going native
  finishes a journey the codebase is more than halfway through.

## Effort estimate (order of magnitude)

Assuming the MySQL design's Phase 1 (shared extraction + conformance suite) has
landed — which is load-bearing for this estimate, because the conformance suite is
what makes the rewrite verifiable:

| Work item | Estimate |
|---|---|
| Shared migration runner + per-adapter ledger (generalise search-postgres's) | 2–3 days |
| SQL tag helper (per driver family) + property tests | 3–4 days |
| db-postgres storage module conversion (fragments → functions, drop builder edges) | 1–1.5 weeks |
| db-postgres admin repositories rewrite | 1 week |
| db-postgres views/schema → canonical DDL + boot verification | 2–3 days |
| db-mysql equivalents (if done after db-mysql exists: conversion; if before: absorbed into its build) | ~60% of the above |
| **Total, both adapters** | **≈ 5–7 focused weeks** |

## Recommendation

**Defer — do not couple this to db-mysql v1. Shrink the Drizzle surface instead of
ripping it out, and set explicit re-evaluation triggers.**

Concretely:

1. **Build `@byline/db-mysql` with Drizzle** per the companion design. Two moving
   variables per port decision is one too many, and the conformance suite —
   the instrument that would make a native rewrite safe — only exists at full
   strength once the second adapter has hardened it.
2. **Adopt the containment policy now** (cheap, immediate):
   - New storage-module code prefers raw ``sql`...` `` fragments over builder calls
     (the de-facto pattern already — make it the stated one).
   - The canonical-DDL habit continues: every schema change lands in both the
     Drizzle schema *and* the hand-written `sql/` stream (already required for
     production).
   - No new Drizzle surface area: no `drizzle-zod`, no relational query API
     (`db.query.*`), no Drizzle-specific features that deepen the coupling.
3. **Re-evaluate — and likely go native — when any trigger fires:**
   - a third adapter is scheduled (three dialects on one dev-time diffing tool is
     where drizzle-kit's value inverts into coordination cost);
   - a Drizzle major/breaking upgrade would force non-trivial adapter work anyway
     (do the exit instead of the upgrade);
   - the two-stream migration split causes a production incident or measurable
     recurring friction;
   - benchmark work needs SQL the builder obstructs.

The end-state is attractive and the codebase is closer to it than it looks — but it
is a consolidation project, best done against a proven conformance suite in a quiet
window, not entangled with the first multi-dialect release.
