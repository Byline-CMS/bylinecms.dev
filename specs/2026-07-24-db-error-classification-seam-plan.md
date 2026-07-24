# Database error-classification seam (`classifyError`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the one Postgres-specific error-shape check in shared code (`rethrowPathConflict`) behind an adapter-agnostic, code-based `classifyError` seam on `IDbAdapter`, so `@byline/core` maps database failures to domain errors without knowing driver anatomy — unblocking the db-mysql write path (#42 Task 9).

**Architecture:** The adapter exposes `classifyError(err): DbErrorClassification` (a returned value keyed by a string `code` constant — the error-side analogue of the `normalizeRow` row seam). `@byline/core`'s `rethrowPathConflict` calls it and maps `DB_UNIQUE_VIOLATION` on the path constraint to the existing domain error `ERR_PATH_CONFLICT`. db-postgres implements the classifier by lifting the exact `23505` + cause-walk logic out of core, so its behaviour is byte-identical. db-mysql's classifier is specified in the design but implemented later in Phase 2.

**Tech Stack:** TypeScript (ESM), Vitest, Drizzle ORM (`node-postgres`), pg. No new dependencies.

**Spec:** `specs/2026-07-24-db-error-classification-seam-design.md` (approved 2026-07-24). Covers issues [#45](https://github.com/Byline-CMS/bylinecms.dev/issues/45) (the seam) and [#46](https://github.com/Byline-CMS/bylinecms.dev/issues/46) (two doc items, folded in). The design's Sections 1–3 are normative for the exact types and code.

## Global Constraints

- Every new source file starts with the MPL-2.0 header block (copy verbatim from a sibling file; it names "Infonomic Company Limited").
- Biome formatting: 2-space indent, single quotes, no semicolons, 100-char lines, ES5 trailing commas. Run `pnpm lint` (repo root) before each commit. Never introduce ESLint/Prettier.
- Import ordering (Biome-enforced): Node builtins → packages (`@byline/*`) → local relative, blank-line separated. Cross-package imports use the package name; within-package relative imports use the `.js` extension (ESM).
- Commits: conventional format `type(scope): lowercase past-tense message`, single line. Sign-off REQUIRED: `git commit -s`. `Signed-off-by` is the ONLY permitted trailer — no Co-Authored-By, no AI attribution.
- **Behaviour-preserving for db-postgres:** the same `ERR_PATH_CONFLICT` must surface from the same driver errors. The parity gate is the db-postgres integration suite (`cd packages/db-postgres && pnpm test:integration` = 173 tests, 0 skipped) staying green throughout.
- Monorepo: pnpm + Turborepo. Root `pnpm typecheck` covers the workspace. `byline_test` Postgres is assumed running and initialised (`pnpm db:init:test` with `PGPASSWORD=test` if a reset is needed).
- The exact type shapes and code in the design's Sections 1–3 are normative — copy them, do not re-invent names (`DbErrorCodes`, `DbErrorClassification`, `classifyError`, `DB_UNIQUE_VIOLATION`, `DB_UNKNOWN`).

---

### Task 0: Feature branch

**Files:** none (git only)

- [ ] **Step 0.1: Create the branch off current develop**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
git checkout develop && git pull
git checkout -b feat/db-error-classification-seam
```

Expected: `Switched to a new branch 'feat/db-error-classification-seam'`.

---

### Task 1: The classifier seam — core types + db-postgres implementation (additive, green)

This task adds the seam's *producer* half: the core types, the optional `IDbAdapter` method, and db-postgres's implementation with a unit test. Nothing consumes it yet, so all suites stay green (pure addition). Task 2 switches the consumer over.

**Files:**
- Modify: `packages/core/src/lib/errors.ts` (add the `DbErrorCodes` const, `DbErrorCode` type, `DbErrorClassification` interface — beside the existing `ErrorCodes`, separate from it because these are returned classification values, not thrown `BylineError`s)
- Modify: `packages/core/src/@types/db-types.ts` (import `type DbErrorClassification` from `../lib/errors.js`; add the optional `classifyError?` method to `IDbAdapter`)
- Verify: `packages/core/src/index.ts` already re-exports `lib/errors.js` and `@types/db-types.js` (it does — confirm `DbErrorCodes` / `DbErrorClassification` are reachable from `@byline/core`; add exports only if a grep shows they are not)
- Create: `packages/db-postgres/src/modules/storage/classify-error.ts`
- Create: `packages/db-postgres/src/modules/storage/classify-error.test.node.ts`
- Modify: `packages/db-postgres/src/index.ts` (wire `classifyError` onto the adapter object returned at `return { … }`, line ~153)

**Interfaces:**
- Produces (Task 2 and the db-mysql adapter rely on these exact names):
  - `DbErrorCodes = { UNIQUE_VIOLATION: 'DB_UNIQUE_VIOLATION', UNKNOWN: 'DB_UNKNOWN' } as const`
  - `type DbErrorCode = (typeof DbErrorCodes)[keyof typeof DbErrorCodes]`
  - `interface DbErrorClassification { code: DbErrorCode; constraint?: string }`
  - `IDbAdapter.classifyError?(err: unknown): DbErrorClassification`
  - `classifyError(err: unknown): DbErrorClassification` exported from `packages/db-postgres/src/modules/storage/classify-error.ts`

- [ ] **Step 1.1: Add the core types**

In `packages/core/src/lib/errors.ts`, after the `ErrorCodes` block, add:

```ts
// ---------------------------------------------------------------------------
// Database error classification (adapter seam)
// ---------------------------------------------------------------------------

/**
 * Code-based classification of a raw database driver error, produced by
 * `IDbAdapter.classifyError`. The error-side analogue of the storage
 * `normalizeRow` seam: the adapter canonicalises driver anatomy into these
 * codes so `@byline/core` can map DB failures to domain errors (e.g.
 * `ERR_PATH_CONFLICT`) without knowing any driver's error shape.
 *
 * Distinct from `ErrorCodes` above: those are thrown `BylineError` codes;
 * these are returned classification values. Extend with new codes (e.g. a
 * future `STALE_RECORD` for optimistic-concurrency failures) as consumers
 * need them.
 */
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
   * the error message). Absent when the driver surfaces no name.
   */
  constraint?: string
}
```

- [ ] **Step 1.2: Add the optional `IDbAdapter` method**

In `packages/core/src/@types/db-types.ts`, add a type-only import for `DbErrorClassification` from `../lib/errors.js` (top of file, with the other imports), then add to the `IDbAdapter` interface (near `backfillSourceLocales?`, the existing optional-method precedent):

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

- [ ] **Step 1.3: Typecheck the core additions**

Run: `pnpm --filter @byline/core typecheck` (or root `pnpm typecheck`)
Expected: clean. Confirm `import { DbErrorCodes, type DbErrorClassification } from '@byline/core'` resolves (quick check: `rg "export \* from './lib/errors" packages/core/src/index.ts` and `rg "db-types" packages/core/src/index.ts`). If either symbol is not surfaced by the barrel, add the export.

- [ ] **Step 1.4: Write the failing db-postgres classifier test**

`packages/db-postgres/src/modules/storage/classify-error.test.node.ts` (MPL header first):

```ts
import { describe, expect, it } from 'vitest'

import { classifyError } from './classify-error.js'

describe('classifyError (postgres)', () => {
  it('classifies a raw 23505 as DB_UNIQUE_VIOLATION with the constraint', () => {
    const err = { code: '23505', constraint: 'document_paths_collection_locale_path' }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'document_paths_collection_locale_path',
    })
  })

  it('walks a Drizzle-style cause chain to the underlying pg error', () => {
    const err = { name: 'DrizzleQueryError', cause: { code: '23505', constraint: 'some_other_unique' } }
    expect(classifyError(err)).toEqual({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'some_other_unique',
    })
  })

  it('returns DB_UNKNOWN for a non-unique error', () => {
    expect(classifyError({ code: '23503' })).toEqual({ code: 'DB_UNKNOWN' })
  })

  it('returns DB_UNKNOWN for a non-error value', () => {
    expect(classifyError(undefined)).toEqual({ code: 'DB_UNKNOWN' })
    expect(classifyError('boom')).toEqual({ code: 'DB_UNKNOWN' })
  })
})
```

- [ ] **Step 1.5: Run it to confirm it fails**

Run: `cd packages/db-postgres && pnpm test --mode=node classify-error`
Expected: FAIL — `Cannot find module './classify-error.js'`.

- [ ] **Step 1.6: Implement the classifier**

`packages/db-postgres/src/modules/storage/classify-error.ts` (MPL header first):

```ts
import { type DbErrorClassification, DbErrorCodes } from '@byline/core'

/**
 * Classify a Postgres driver error. Walks a short `cause` chain
 * (DrizzleQueryError → underlying pg error) looking for SQLSTATE `23505`
 * (unique violation) and returns the carried constraint name. This is the
 * driver-anatomy logic formerly inlined in core's `rethrowPathConflict`;
 * core now maps the returned classification to `ERR_PATH_CONFLICT`.
 */
export function classifyError(err: unknown): DbErrorClassification {
  type PgLikeError = { code?: string; constraint?: string; cause?: unknown }
  let e = err as PgLikeError | undefined
  for (let i = 0; i < 3 && e != null && typeof e === 'object'; i++) {
    if (e.code === '23505') {
      return { code: DbErrorCodes.UNIQUE_VIOLATION, constraint: e.constraint }
    }
    e = e.cause as PgLikeError | undefined
  }
  return { code: DbErrorCodes.UNKNOWN }
}
```

- [ ] **Step 1.7: Wire it onto the adapter**

In `packages/db-postgres/src/index.ts`: import `classifyError` from `./modules/storage/classify-error.js`, and add `classifyError,` to the object literal returned at `return { … }` (line ~153), beside `withTransaction`. Add `classifyError(err: unknown): DbErrorClassification` to the `PgAdapter` interface if that interface enumerates methods explicitly (it extends `IDbAdapter`, so the optional method is already inherited — add an explicit line only if the file's style pins each method; otherwise no interface edit is needed).

- [ ] **Step 1.8: Run the classifier test — GREEN**

Run: `cd packages/db-postgres && pnpm test --mode=node classify-error`
Expected: PASS (4 tests).

- [ ] **Step 1.9: Parity + typecheck gate**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
pnpm typecheck
cd packages/db-postgres && pnpm test:integration 2>&1 | tail -3
```

Expected: typecheck clean; integration = 173 tests, 0 skipped (unchanged — nothing consumes `classifyError` yet).

- [ ] **Step 1.10: Lint + commit**

```bash
pnpm lint
git add packages/core/src/lib/errors.ts packages/core/src/@types/db-types.ts packages/core/src/index.ts packages/db-postgres/src/modules/storage/classify-error.ts packages/db-postgres/src/modules/storage/classify-error.test.node.ts packages/db-postgres/src/index.ts
git commit -s -m "feat(core): added classifyError adapter seam with the postgres classifier"
```

---

### Task 2: Core consumes the seam — rewire `rethrowPathConflict` + conformance

Switches the consumer over: `rethrowPathConflict` now delegates driver anatomy to `db.classifyError`, the six call sites pass the adapter, a new core unit test covers the mapping with a fake adapter, and the conformance suite asserts the seam instead of the raw pg shape. db-postgres behaviour is identical, so the integration suite stays green.

**Files:**
- Modify: `packages/core/src/services/document-lifecycle/internals.ts` (`rethrowPathConflict` signature + body)
- Create: `packages/core/src/services/document-lifecycle/rethrow-path-conflict.test.node.ts` (new focused unit test — no DB)
- Modify (call sites, add the adapter argument): `packages/core/src/services/document-lifecycle/create.ts:137`, `update.ts:149`, `update.ts:319`, `system-fields.ts:154`, `duplicate.ts:241`, `duplicate.ts:268`
- Modify: `packages/db-conformance/src/suites/document-paths.ts` (swap the raw-`23505` assertion block for the seam assertion)

**Interfaces:**
- Consumes: `IDbAdapter.classifyError?`, `DbErrorCodes` from `@byline/core` (Task 1).
- Changes: `rethrowPathConflict(db: IDbAdapter, err: unknown, path: string, locale: string): never` — first parameter added. All callers hold a `db` / `ctx.db` in scope.

- [ ] **Step 2.1: Write the failing core unit test**

`packages/core/src/services/document-lifecycle/rethrow-path-conflict.test.node.ts` (MPL header first). It injects a fake adapter and asserts the four mapping outcomes:

```ts
import { describe, expect, it } from 'vitest'

import type { DbErrorClassification, IDbAdapter } from '../../@types/index.js'
import { ErrorCodes } from '../../lib/errors.js'

import { rethrowPathConflict } from './internals.js'

const adapterWith = (c: DbErrorClassification | undefined): IDbAdapter =>
  ({ classifyError: c === undefined ? undefined : () => c }) as unknown as IDbAdapter

describe('rethrowPathConflict', () => {
  it('maps a unique violation on the path constraint to ERR_PATH_CONFLICT', () => {
    const db = adapterWith({
      code: 'DB_UNIQUE_VIOLATION',
      constraint: 'byline_document_paths_document_paths_collection_locale_path',
    })
    try {
      rethrowPathConflict(db, new Error('raw'), 'news/hello', 'en')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { code?: string }).code).toBe(ErrorCodes.PATH_CONFLICT)
    }
  })

  it('rethrows raw when the unique violation is on a different constraint', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNIQUE_VIOLATION', constraint: 'some_other_unique' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })

  it('rethrows raw for DB_UNKNOWN', () => {
    const raw = new Error('raw')
    const db = adapterWith({ code: 'DB_UNKNOWN' })
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })

  it('rethrows raw when the adapter has no classifyError', () => {
    const raw = new Error('raw')
    const db = adapterWith(undefined)
    expect(() => rethrowPathConflict(db, raw, 'p', 'en')).toThrow(raw)
  })
})
```

- [ ] **Step 2.2: Run it to confirm it fails**

Run: `cd packages/core && pnpm test rethrow-path-conflict`
Expected: FAIL — the current `rethrowPathConflict(err, path, locale)` signature rejects the `db` first argument (type error) / the calls don't behave as asserted.

- [ ] **Step 2.3: Rewire `rethrowPathConflict`**

In `packages/core/src/services/document-lifecycle/internals.ts`, replace the body of `rethrowPathConflict` (keep the surrounding doc comment, updated) with:

```ts
export function rethrowPathConflict(
  db: IDbAdapter,
  err: unknown,
  path: string,
  locale: string
): never {
  const classification = db.classifyError?.(err)
  if (
    classification?.code === DbErrorCodes.UNIQUE_VIOLATION &&
    classification.constraint?.includes('document_paths_collection_locale_path')
  ) {
    throw ERR_PATH_CONFLICT({
      message: `path "${path}" is already in use in this collection (locale: ${locale})`,
      details: { path, locale, constraint: classification.constraint },
    })
  }
  throw err as Error
}
```

Add the imports this needs to `internals.ts`: `DbErrorCodes` from `../../lib/errors.js` and, if not already imported, `type IDbAdapter` from `../../@types/index.js`. Update the function's doc comment to describe delegation to `db.classifyError` (the Postgres SQLSTATE detail now lives in the adapter).

- [ ] **Step 2.4: Update the six call sites**

At each site, add the in-scope adapter as the first argument. The variable is the `db` / `ctx.db` already used for the adjacent `db.commands…` call — use whichever identifier that site already has:

- `create.ts:137` → `.catch((err: unknown) => rethrowPathConflict(db, err, resolvedPath, defaultLocale))`
- `update.ts:149` → `rethrowPathConflict(db, err, pathForCommand ?? '', defaultLocale)`
- `update.ts:319` → `rethrowPathConflict(db, err, pathForCommand ?? '', defaultLocale)`
- `system-fields.ts:154` → `rethrowPathConflict(db, err, pathForCommand, sourceLocale)`
- `duplicate.ts:241` → `rethrowPathConflict(db, err, finalPath, defaultLocale)`
- `duplicate.ts:268` → `rethrowPathConflict(db, retryErr, finalPath, defaultLocale)`

If any site does not have a local `db`, use `ctx.db` (the `DocumentLifecycleContext` carries it). `pnpm typecheck` will flag any site missed (new required first parameter).

- [ ] **Step 2.5: Run the core unit test — GREEN, then typecheck**

```bash
cd packages/core && pnpm test rethrow-path-conflict
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev && pnpm typecheck
```

Expected: unit test PASS (4 tests); typecheck clean (all six call sites updated).

- [ ] **Step 2.6: Swap the conformance assertion**

In `packages/db-conformance/src/suites/document-paths.ts`, the duplicate-path test currently asserts the raw pg shape (`const original = caught.cause ?? caught; expect(original.code…).toBe('23505'); expect(original.constraint…).toMatch(…)`). Replace that assertion block (keep the `try/catch` that provokes the duplicate and the `expect(caught, …).toBeTruthy()` line) with an adapter-agnostic assertion against the seam:

```ts
      expect(caught, 'expected unique-constraint violation on duplicate path').toBeTruthy()
      // Adapter-agnostic: the adapter classifies its own driver error; core maps
      // this classification to ERR_PATH_CONFLICT. (The raw Postgres 23505/anatomy
      // is pinned in db-postgres's own classify-error unit test.)
      const classification = adapter.classifyError!(caught)
      expect(classification.code).toBe('DB_UNIQUE_VIOLATION')
      expect(classification.constraint ?? '').toContain('document_paths_collection_locale_path')
```

Update the comment above the block (the one describing `rethrowPathConflict` reading 23505) to match. Remove the now-unused `original` local.

- [ ] **Step 2.7: Full parity gate**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
pnpm typecheck
cd packages/core && pnpm test 2>&1 | tail -3
cd ../db-postgres && pnpm test:integration 2>&1 | tail -3
```

Expected: typecheck clean; core tests green (prior count + the 4 new `rethrow-path-conflict` tests); db-postgres integration = 173 tests, 0 skipped (the swapped conformance assertion still passes — db-postgres's `classifyError` returns `DB_UNIQUE_VIOLATION` with the path constraint, and `ERR_PATH_CONFLICT` still surfaces identically through the lifecycle path-conflict scenarios).

- [ ] **Step 2.8: Lint + commit**

```bash
pnpm lint
git add packages/core/src/services/document-lifecycle/ packages/db-conformance/src/suites/document-paths.ts
git commit -s -m "refactor(core): routed path-conflict detection through the classifyError seam"
```

---

### Task 3: The #46 documentation items

Two trivial doc/comment fixes that ride in this PR (per the spec). No behaviour change; no test.

**Files:**
- Modify: `packages/db-conformance/src/index.ts` (correct the `ConformanceHooks` interface docs)
- Modify: `packages/core/src/storage/store-manifest.ts` (add the `text[]` → MySQL mapping comment on the `object_keys` column)

- [ ] **Step 3.1: Fix the ConformanceHooks docs**

In `packages/db-conformance/src/index.ts`, correct the `ConformanceHooks` interface doc comments to match the actual call contract:
- `truncate()`: change "Called between test files" to "Called once per suite, from each suite's `beforeAll`."
- `createAdapter()`: add that it is called once per suite (~14× per run) and paired with a single `teardown()` at the end of the run; state that implementations should **memoise their connection pool** across calls (open it once, reuse it) rather than opening a fresh pool per call, to avoid leaking pools until teardown.

- [ ] **Step 3.2: Add the `text[]` nullCast mapping note**

In `packages/core/src/storage/store-manifest.ts`, on the `object_keys` column entry (its `nullCast: 'text[]'`), add a comment recording the MySQL mapping decision so #42 Task 10 does not stall:

```ts
    // nullCast 'text[]' is the one abstract type with no MySQL array equivalent.
    // MySQL adapter maps it to `CAST(NULL AS JSON)` in its UNION null casts
    // (Postgres uses `NULL::text[]`). See specs/2026-07-24-db-error-classification-seam-design.md §6.
```

(Place it adjacent to the `object_keys` `ColumnDef` entry; match the file's existing comment style.)

- [ ] **Step 3.3: Typecheck, lint, commit**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
pnpm typecheck && pnpm lint
git add packages/db-conformance/src/index.ts packages/core/src/storage/store-manifest.ts
git commit -s -m "docs(db-conformance): corrected hooks call-contract docs and noted the mysql text[] nullCast mapping"
```

Expected: typecheck + lint clean.

---

### Task 4: Changeset and PR

**Files:**
- Create: `.changeset/<slug>.md`

- [ ] **Step 4.1: Write the changeset**

Create `.changeset/db-error-classification-seam.md`:

```markdown
---
"@byline/core": minor
"@byline/db-postgres": patch
---

Added a code-based `classifyError` adapter seam (`IDbAdapter.classifyError`, `DbErrorCodes`, `DbErrorClassification`) so `@byline/core` maps database failures to domain errors without inspecting driver-specific error anatomy. `rethrowPathConflict` now delegates to it; `@byline/db-postgres` implements the classifier by moving its existing `23505` + cause-walk detection behind the seam (behaviour unchanged). This is the error-side analogue of the storage `normalizeRow` seam and unblocks a second database adapter.
```

(The private `@byline/db-conformance` package is not published and is excluded from the changeset automatically.)

- [ ] **Step 4.2: Final full gate**

```bash
cd /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev
pnpm typecheck && pnpm lint
pnpm test 2>&1 | tail -5
cd packages/db-postgres && pnpm test:integration 2>&1 | tail -3
```

Expected: all green; integration 173 / 0 skipped.

- [ ] **Step 4.3: Commit the changeset, push, open the PR**

```bash
git add .changeset/db-error-classification-seam.md
git commit -s -m "chore: added changeset for the classifyError seam"
git push -u origin feat/db-error-classification-seam
gh pr create --repo Byline-CMS/bylinecms.dev --base develop \
  --title "feat(core): classifyError adapter seam for cross-dialect DB error classification" \
  --body "<see Step 4.4>"
```

- [ ] **Step 4.4: PR body**

The body summarises: the seam (core types + optional `IDbAdapter.classifyError` + `rethrowPathConflict` delegation); db-postgres classifier lifted from core with identical behaviour (173/0 integration parity); the conformance assertion swapped to the seam with the raw-`23505` anatomy pinned in a db-postgres unit test; the two #46 doc items. Include `Closes #45` and `Closes #46`, and a link to `specs/2026-07-24-db-error-classification-seam-design.md`. **No AI attribution of any kind** (no "Generated with Claude Code", no robot emoji, no Co-Authored-By).

---

## Self-review

- **Spec coverage:** design §1 (types + method) → Task 1 Steps 1.1–1.2; §2 (core mapping + 6 sites) → Task 2 Steps 2.3–2.4; §3 (pg classifier; mysql specified-not-built) → Task 1 Steps 1.4–1.8 (db-mysql explicitly out of scope, spec §Out of scope); §4 (conformance swap + pg unit test) → Task 2 Step 2.6 + Task 1 Steps 1.4–1.8; §5 (tests/parity, no release) → the parity gates in Tasks 1–2 and the changeset (no publish); §6 (#46 items) → Task 3; out-of-scope register honoured (no db-mysql classifier, no message relocation, no taxonomy beyond UNIQUE_VIOLATION/UNKNOWN).
- **Type consistency:** `DbErrorCodes` / `DbErrorClassification` / `DbErrorCode` / `classifyError` / `DB_UNIQUE_VIOLATION` / `DB_UNKNOWN` used identically in every task and match the design verbatim. `rethrowPathConflict(db, err, path, locale)` signature is consistent between its definition (2.3) and all six call sites (2.4) and the unit test (2.1).
- **Placeholder scan:** the only deferred value is the PR body prose (Step 4.4), described in full — no `TODO`/`TBD` in code steps.
- **Ordering safety:** Task 1 is purely additive (seam producer, nothing consumes it → suites stay green); Task 2 switches the consumer with db-postgres's classifier already present (→ green); a missed call site is a compile error, not a silent bug. db-postgres integration parity (173/0) is asserted at the end of both Task 1 and Task 2.
