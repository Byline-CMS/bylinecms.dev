# Database error-classification seam (`classifyError`) — design

Date: 2026-07-24
Issues: [#45 Error-normalisation seam](https://github.com/Byline-CMS/bylinecms.dev/issues/45) (primary), [#46 ConformanceHooks docs + `text[]` nullCast](https://github.com/Byline-CMS/bylinecms.dev/issues/46) (folded in — trivial, same PR)
Status: approved in brainstorming with Tony, 2026-07-24
Companions:
- `specs/2026-07-24-db-mysql-adapter-design.md` — the MySQL adapter this seam unblocks (its Task 9 write path depends on this landing first).
- `specs/2026-07-24-db-mysql-adapter-plan.md` — Phase 2 plan; the db-mysql `classifyError` is implemented there, guided by this spec.

## Purpose

Byline has exactly one place in shared code (`@byline/core`) that inspects a
database driver's error anatomy: `rethrowPathConflict`
(`packages/core/src/services/document-lifecycle/internals.ts`). It walks the
error's `cause` chain looking for Postgres SQLSTATE `23505` and a `constraint`
name containing `document_paths_collection_locale_path`, and translates that
into the domain error `ERR_PATH_CONFLICT`. It is called from six lifecycle sites
(create, update ×2, system-fields, duplicate ×2), each via `.catch()` around the
adapter's path write.

That check is Postgres-specific. mysql2 raises a duplicate-key error as
`{ code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' }` with **no**
`constraint` property (the index name lives only inside `sqlMessage`). So a
future MySQL adapter would fail both `rethrowPathConflict` and the conformance
suite that pins the pg shape — unless the driver-error anatomy is moved behind
the adapter boundary. This is precisely the class of leaked-Postgres-assumption
that the adapter-seam programme (issue #41, shipped in v4.7.0) exists to flush;
it surfaced too late for Phase 1 and is pinned rather than abstracted today.

This design adds a small, code-based **error-classification seam** so core maps
database failures to domain errors without knowing any driver's anatomy — the
error-side analogue of the `normalizeRow` row seam. It must land before
[#42](https://github.com/Byline-CMS/bylinecms.dev/issues/42) Task 9 (the db-mysql
write path).

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Seam generality | **Small general taxonomy** — classify into `DB_UNIQUE_VIOLATION` (with the constraint name) plus a catch-all `DB_UNKNOWN`. Not single-purpose; not a full SQLSTATE taxonomy. Future conditions (e.g. optimistic-concurrency `STALE_RECORD`) slot in as new codes with no seam change |
| Error layer | **A1 — core-internal classification.** The adapter exposes a classifier returning a value; only core consumes it; callers still see only domain `BylineError`s (`ERR_PATH_CONFLICT`). Not A2 (adapter throws coded `DbError`s to all callers) — deferred until a second consumer actually needs raw DB codes |
| Shape | Code-based, consistent with Byline's existing `ErrorCodes` / `BylineError` model — a `DbErrorClassification` keyed by a string `code` constant, **returned** (not thrown), mirroring `normalizeRow` (adapter canonicalises, core interprets) |
| Method name | `classifyError` (not the issue's "normalizeError") — it returns a *classification*, not a normalized error object |
| Optionality | Optional on `IDbAdapter` with a core-side fallback (absent ⇒ `DB_UNKNOWN` ⇒ rethrow raw = today's behaviour), so untyped JS adapters keep working |
| Constraint identity | By constraint/index **name substring** (`document_paths_collection_locale_path`), a shared contract string held in core; both adapters name their path unique index to contain it. Not a semantic tag indirection |
| Human messages | Out of scope. Byline's errors carry an upstream system `message` alongside `code` + `details`; moving all human strings to the UI/i18n layer is a separate cross-cutting refactor this spec does not undertake |
| db-mysql classifier | Specified here, **implemented in Phase 2** (#42) when the package exists. #45's code scope is core + db-postgres + conformance only |

## Section 1 — the classification contract (`@byline/core`)

A new code-based classification value, defined beside (but separate from) the
existing `ErrorCodes` in `packages/core/src/lib/errors.ts` — separate because
this is a different layer: low-level DB conditions, **returned** as classification
values, not **thrown** as `BylineError`s.

```ts
export const DbErrorCodes = {
  UNIQUE_VIOLATION: 'DB_UNIQUE_VIOLATION',
  UNKNOWN: 'DB_UNKNOWN',
} as const

export type DbErrorCode = (typeof DbErrorCodes)[keyof typeof DbErrorCodes]

export interface DbErrorClassification {
  code: DbErrorCode
  /**
   * For `DB_UNIQUE_VIOLATION`: the violated constraint / index name when the
   * driver exposes it (Postgres carries it structurally; MySQL parses it from
   * the error message). Absent when the driver does not surface a name.
   */
  constraint?: string
}
```

A new **optional** method on `IDbAdapter` (`packages/core/src/@types/db-types.ts`),
following the `backfillSourceLocales?` precedent:

```ts
/**
 * Classify a raw driver error into an adapter-agnostic, code-based shape so
 * core can map database failures to domain errors without knowing driver
 * anatomy. The error-side analogue of the storage `normalizeRow` seam.
 *
 * Optional: when absent, core treats every error as `DB_UNKNOWN` and rethrows
 * it unchanged — the current behaviour for adapters that do not implement it.
 * Canonical adapters (db-postgres, db-mysql) implement it.
 */
classifyError?(err: unknown): DbErrorClassification
```

Rationale: code-based to match Byline's `BylineError.code` family and the
constant-switching flow used in prior projects; returned-not-thrown to keep the
classifier a pure function and mirror `normalizeRow`; extensible — a future
`DB_STALE_RECORD` (optimistic-concurrency failure) is a one-line addition to
`DbErrorCodes` with no change to the seam or its consumers.

## Section 2 — core mapping (`rethrowPathConflict`)

`rethrowPathConflict` gains the adapter as its first argument (already in scope
as `ctx.db` / `db` at all six call sites) and delegates driver anatomy to it:

```ts
export function rethrowPathConflict(
  db: IDbAdapter,
  err: unknown,
  path: string,
  locale: string
): never {
  const c = db.classifyError?.(err)
  if (
    c?.code === DbErrorCodes.UNIQUE_VIOLATION &&
    c.constraint?.includes('document_paths_collection_locale_path')
  ) {
    throw ERR_PATH_CONFLICT({
      message: `path "${path}" is already in use in this collection (locale: ${locale})`,
      details: { path, locale, constraint: c.constraint },
    })
  }
  throw err as Error
}
```

- The six call sites (`create.ts`, `update.ts` ×2, `system-fields.ts`,
  `duplicate.ts` ×2) change from `rethrowPathConflict(err, …)` to
  `rethrowPathConflict(ctx.db, err, …)` — a mechanical argument addition.
- The `.includes('document_paths_collection_locale_path')` shared-contract string
  stays in core. Both adapters must name their path unique index so its name
  contains that substring.
- The `cause`-chain walk that lives in core today **moves into the pg adapter's
  classifier** (Section 3), where driver anatomy belongs.
- `isPathConflictError` (checks the already-translated `ERR_PATH_CONFLICT` code)
  is unchanged — it inspects the domain code, not a driver shape.

Behaviour is preserved for db-postgres: its `classifyError` reproduces the exact
`23505` + cause-walk logic, so the same driver errors map to `ERR_PATH_CONFLICT`
identically.

## Section 3 — adapter classifiers

### db-postgres (implemented in this work)

`classifyError` is the logic lifted verbatim from today's `rethrowPathConflict`:

```ts
// packages/db-postgres/src/modules/storage/classify-error.ts (new)
export function classifyError(err: unknown): DbErrorClassification {
  type PgLikeError = { code?: string; constraint?: string; cause?: unknown }
  let e = err as PgLikeError | undefined
  for (let i = 0; i < 3 && e; i++) {            // DrizzleQueryError → pg error
    if (e.code === '23505') {
      return { code: DbErrorCodes.UNIQUE_VIOLATION, constraint: e.constraint }
    }
    e = e.cause as PgLikeError | undefined
  }
  return { code: DbErrorCodes.UNKNOWN }
}
```

Wired onto the adapter object returned by `pgAdapter(...)`.

### db-mysql (specified here, implemented in Phase 2 / #42)

mysql2's duplicate-key error carries `errno === 1062` (`code === 'ER_DUP_ENTRY'`)
and exposes the index name only inside `sqlMessage`
(`Duplicate entry '<value>' for key '<table>.<keyname>'` — the `<table>.` prefix
is present in MySQL 8). The classifier:

```ts
export function classifyError(err: unknown): DbErrorClassification {
  type MyErr = { errno?: number; code?: string; sqlMessage?: string; cause?: unknown }
  let e = err as MyErr | undefined
  for (let i = 0; i < 3 && e; i++) {
    if (e.errno === 1062 || e.code === 'ER_DUP_ENTRY') {
      const m = e.sqlMessage?.match(/for key '(?:[^.]*\.)?([^']+)'/)
      return { code: DbErrorCodes.UNIQUE_VIOLATION, constraint: m?.[1] }
    }
    e = e.cause as MyErr | undefined
  }
  return { code: DbErrorCodes.UNKNOWN }
}
```

Requirement carried into #42 Task 8: the MySQL unique index on
`byline_document_paths(collection_id, locale, path)` is named to contain
`document_paths_collection_locale_path` (37 chars, under MySQL's 64-char index-name
limit), so the parsed `constraint` satisfies core's substring match unchanged.

## Section 4 — conformance suite

The shared suite `packages/db-conformance/src/suites/document-paths.ts` currently
asserts the raw Postgres shape (`caught.cause.code === '23505'` and a constraint
regex) — the exact leak this seam removes. Replace those assertions with an
adapter-agnostic assertion against the seam:

```ts
const c = adapter.classifyError!(caught)
expect(c.code).toBe('DB_UNIQUE_VIOLATION')
expect(c.constraint ?? '').toContain('document_paths_collection_locale_path')
```

Both canonical adapters implement `classifyError`, so the suite asserts it
directly. A behavioural assertion that a duplicate path **rejects** (the write
throws at all) stays, adapter-agnostic.

The Postgres-specific anatomy does not disappear — it moves to a **db-postgres
unit test** for `classifyError` (`classify-error.test.node.ts`), pinning:
`23505` (wrapped in a Drizzle-style `cause`) → `DB_UNIQUE_VIOLATION` with the
constraint carried through; a non-unique error → `DB_UNKNOWN`. This matches the
residual-pg-test pattern established when the storage suites were extracted.

## Section 5 — tests and parity

- **db-postgres** passes the updated conformance suite with no behavioural change
  — the same `ERR_PATH_CONFLICT` surfaces from the same driver errors (Phase 1
  parity discipline).
- **New db-postgres unit test** for `classifyError` (Section 4).
- **Core** — the existing `rethrowPathConflict` test updates to the new
  `(db, err, path, locale)` signature, injecting a fake adapter whose
  `classifyError` returns each `DbErrorClassification` variant. This exercises
  core's mapping (unique-violation-with-matching-constraint → `ERR_PATH_CONFLICT`;
  unique-violation-with-other-constraint → rethrow raw; `DB_UNKNOWN` → rethrow
  raw; absent `classifyError` → rethrow raw) with **no** database.
- Lands on `develop`. **No release** is required before Phase 2 — db-mysql
  consumes `@byline/core` in-workspace, not from npm.

## Section 6 — the #46 items (folded into the same PR)

Both are trivial and touch files this work is already in; they ride along rather
than getting their own PR.

- **ConformanceHooks documentation** (`packages/db-conformance/src/index.ts`) —
  correct the interface doc to match the actual call contract:
  `truncate()` is called once per suite from each suite's `beforeAll` (not
  "between test files"); `createAdapter()` is called once per suite (~14× per
  run) with a single `teardown()` at the end; state the memoise-your-pool
  expectation on the interface itself, so a second-adapter author does not leak a
  pool per suite.
- **`text[]` nullCast note** (`packages/core/src/storage/store-manifest.ts`) — a
  comment on the `object_keys` column recording the MySQL mapping decision
  (`CAST(NULL AS JSON)`), since `text[]` is the one abstract null-cast type name
  with no MySQL array equivalent. Documents the decision so #42 Task 10 does not
  stall; no code change to the manifest data.

## Out of scope

- The **db-mysql `classifyError`** implementation (Phase 2 / #42 — the algorithm
  is specified in Section 3).
- **Approach A2** (adapter throws coded `DbError`s to all callers) — revisit only
  when a consumer beyond core needs to switch on raw DB error codes.
- Moving **human-readable messages** out of upstream errors into the UI/i18n
  layer — a separate cross-cutting refactor.
- Any **DB-error code beyond `UNIQUE_VIOLATION` + `UNKNOWN`** — `STALE_RECORD`,
  FK, not-null, check are future additions when a consumer needs them.

## Risks

1. **MySQL `sqlMessage` parsing fragility** — the classifier depends on the
   `for key '…'` message format. It is stable across MySQL 8; the db-mysql unit
   test (Phase 2) pins it, and a parse miss degrades safely to
   `DB_UNKNOWN`-with-no-constraint (raw rethrow), never a wrong translation.
2. **Shared index-name contract** — both adapters must name the path unique index
   to contain `document_paths_collection_locale_path`. Enforced for MySQL by the
   #42 Task 8 schema-pin test; already true for Postgres.
3. **Signature change ripple** — `rethrowPathConflict` gains an argument at six
   sites; all already hold `ctx.db`. A missed site is a compile error (TypeScript),
   not a silent bug.
