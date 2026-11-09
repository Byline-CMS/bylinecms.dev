---
title: "Toggling a field's localized flag — implementation plan"
path: "localized-toggle-plan"
summary: "Implement read-time conversion, whole-version mismatch detection, identity-merged repair saves and declaration-aware filters for localized-flag toggles in nine reviewable tasks across core and both database adapters."
---

# Toggling a field's localized flag — implementation plan

Companions:

- [Specification](./2026-11-09-localized-toggle-spec.md) — the contract this plan implements. Section and decision numbers below refer to it; conformance case numbers refer to its section 5.
- Issue #106 — the tracking issue.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changing a field's `localized` flag needs no migration: existing documents read without errors or lost values, and each converts to the new shape on its next save.

**Architecture:** Reconstruction in `@byline/core` accepts rows written under the old flag and converts them (spec 4.1, 4.2, 4.2a). A new adapter query lists one version's `(field_path, locale)` pairs so core can detect a mismatch across the whole previous version, and `persistExistingDocumentVersion` sends affected saves through the existing identity-merged `locale: 'all'` write (4.3). The adapters' copy-forward SQL is unchanged. Field filters and sorts carry the field's `localized` flag and choose their locale arms from it (4.4).

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, PostgreSQL, MySQL 8, the shared `packages/db-conformance` suite.

**Spec:** `specs/2026-11-09-localized-toggle-spec.md`

## Start here

1. The specification was accepted on 2026-11-09 after two external review
   rounds. Tony's decisions are spec section 7, decisions 1 and 11. The rest are
   builder's calls recorded there.
2. Commit only when Tony asks, using conventional messages and `git commit -s`.
   The DCO `Signed-off-by` line is the only permitted trailer.
3. Integration and conformance suites need the `byline_test` databases
   (`pnpm db:init:test`; see `docs/13-testing.md`). Run them serially.
4. Recommended execution: subagent-driven, with tasks run strictly in order
   (each task consumes the previous task's interfaces), a fresh review after
   each task, and a whole-branch review at the end. Tony confirms the method
   before execution starts.

## Global Constraints

- No DDL and no new migration in either adapter. The only new adapter surface is one read query (Task 4).
- The adapters' copy-forward SQL (`storage-commands.ts` step 5 in both adapters) must not change.
- Strict reads keep throwing on every existing warning except the two locale-mismatch warnings (4.6).
- Everything lands in both `@byline/db-postgres` and `@byline/db-mysql`, and is proved through `packages/db-conformance`.
- Rebuild `@byline/core` (`pnpm --filter @byline/core build`) before running adapter or conformance tests after any core change. A stale `dist` produces phantom "property does not exist" errors across package boundaries.
- New exported symbols must be used by another package or by tests, or `knip` (run on pre-push) fails.
- Biome formatting: 2-space indent, single quotes, no semicolons, 100-character lines. Run `pnpm lint` before each commit.
- Every new source file starts with the repository's MPL-2.0 header comment.

## Review Focus

The spec implies these conditions, but none of its numbered cases exercises them directly. Each one has a test in the owning task.

1. **Admin editor saves use patches.** `updateDocumentWithPatches` must take the repair path just as `updateDocument` does. Test in Task 5.
2. **Singletons.** A toggled field on a singleton must read and repair the same way through `updateSingleton`. Test in Task 5.
3. **Non-text stores.** A localized `richText` (JSON store) field and a `number` field must convert with their value columns intact. Test in Task 3 for reads and Task 5 for saves.
4. **Copy-to-locale before the first save.** Copying `en` to `fr` with `overwrite: false` on a document whose field became localized must neither lose the `en` value nor write a stray shared row. Test in Task 5.
5. **A field in a group inside an array item.** Path classification must strip indexes and resolve through a group. Test in Task 2 (classification) and Task 5 (save).

---

## Task 1: Confirm the pre-existing positional-translation bug

The spec's "adjacent finding" (end of 4.3) is unverified. Confirm it before
building on the same code path, so the reviewer knows which behaviour is
pre-existing.

**Files:**
- Create: `packages/db-conformance/src/suites/localized-toggle.ts`
- Modify: `packages/db-conformance/src/index.ts` (import, export, and register `localizedToggleSuite(hooks)` after `localeQuerySemanticsSuite(hooks)`)

**Interfaces:**
- Produces: `export function localizedToggleSuite(hooks: ConformanceHooks): void`. It has one `describe('Localized toggle', …)` block. Later tasks add cases to it. Follow `suites/unavailable-blocks.ts` for setup: a lifecycle `context()` helper, `hooks.createAdapter([definition])`, `collections.create`, and toggling by mutating the shared field object (`caption.localized = true`) between writes and reads.

- [ ] **Step 1: Write the test `positional copy-forward misattributes translations after an item removal (pre-existing)`**

  Use a collection with an `items` array of `{ caption: text, localized: true }`.
  Seed with `locale: 'all'`: `items: [{ caption: { en: 'A', fr: 'A-fr' } }, { caption: { en: 'B', fr: 'B-fr' } }]`.
  Read it in `en`, remove the first item while keeping item B's `_id`, and save through `updateDocument` with `locale: 'en'`.
  Read the result with `locale: 'all'`, lenient.
  Expect `items` to have length 1, with `caption` equal to `{ en: 'B', fr: 'B-fr' }`.

- [ ] **Step 2: Run it**

  Run: `pnpm --filter @byline/core build && cd packages/db-postgres && pnpm test:integration tests/conformance.integration.test.ts -t "positional copy-forward"`
  Expected: FAIL. `fr` is `'A-fr'`, or the read reports an orphan index-1 row. If it passes, record that in the handoff, delete the spec's adjacent-finding paragraph, and skip Steps 3–4.

- [ ] **Step 3: Mark the test `it.fails` and leave a comment naming the issue**

  Ask Tony before filing a GitHub issue. Filing is an outward action. Put the issue number in the test comment.

- [ ] **Step 4: Run it on MySQL**

  Run: `cd packages/db-mysql && pnpm test:integration tests/conformance.integration.test.ts -t "positional copy-forward"`
  Expected: the `it.fails` test passes, which means the bug reproduces.

- [ ] **Step 5: Commit** — `test(db-conformance): added localized-toggle suite with pre-existing positional copy-forward reproduction`

## Task 2: Toggle helpers in core

**Files:**
- Create: `packages/core/src/storage/localized-toggle.ts`
- Modify: `packages/core/src/storage/index.ts` (export the new module)
- Test: `packages/core/src/storage/localized-toggle.test.node.ts`

**Interfaces:**
- Produces:
  - `export interface VersionFieldLocale { field_path: string; locale: string }`. `field_path` is the stored dotted path, such as `content.1.photoBlock.alt`.
  - `export interface LocalizationMismatch { field_path: string; locale: string; kind: 'shared-on-localized' | 'locale-on-shared' }`
  - `export function findLocalizationMismatches(fields: FieldSet, pairs: readonly VersionFieldLocale[]): LocalizationMismatch[]`
  - `export function conversionLocales(locales: Iterable<string>, sourceLocale: string): string[]`. It returns the source locale first, then every other distinct locale except `'all'`, in first-seen order.

- [ ] **Step 1: Write the failing tests**

  Use this field set: `title` (text, localized), `alt` (text), `items` (array of `{ meta: group { note: text, localized } }`), and `content` (blocks with `photoBlock { caption: text, localized }`).
  - `findLocalizationMismatches` with `[{ field_path: 'alt', locale: 'fr' }]` → `[{ field_path: 'alt', locale: 'fr', kind: 'locale-on-shared' }]`.
  - With `[{ field_path: 'title', locale: 'all' }]` → kind `'shared-on-localized'`.
  - With `[{ field_path: 'items.0.meta.note', locale: 'all' }]` → kind `'shared-on-localized'`. This is Review Focus 5.
  - With `[{ field_path: 'content.1.photoBlock.caption', locale: 'all' }]` → kind `'shared-on-localized'`.
  - With matching rows (`title`/`en`, `alt`/`all`), an unknown path (`gone`/`fr`), and a reserved name (`path`/`all`) → `[]`.
  - `conversionLocales(['all', 'fr', 'en', 'fr'], 'en')` → `['en', 'fr']`.
  - `conversionLocales([], 'en')` → `['en']`.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `cd packages/core && pnpm vitest run --mode=node src/storage/localized-toggle.test.node.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

  Turn a stored path into a declaration path by splitting on `.` and dropping
  purely numeric segments (the elision pinned by
  `packages/db-postgres/src/modules/storage/storage-paths.test.node.ts`). Then
  call `resolveDeclarationPath(fields, path, { blocks: 'qualified' })`. Treat any
  non-`ok` status as "not a mismatch". The kind follows from comparing
  `field.localized === true` with `locale === 'all'`. Resolve each distinct path
  once.

- [ ] **Step 4: Run them to make sure they pass** (same command; expected PASS)

- [ ] **Step 5: Commit** — `feat(core): added localized-toggle mismatch classification helpers`

## Task 3: Restore rules for toggled fields

**Files:**
- Modify: `packages/core/src/storage/storage-restore.ts` (`restoreFieldSetData`, `restoreFieldData`, and the array/blocks/group helpers that forward `resolveLocale`)
- Test: `packages/core/src/storage/storage-restore-localized-toggle.test.node.ts`

**Interfaces:**
- Produces:
  - `export interface RestoreOptions { sourceLocale?: string; conversionLocales?: readonly string[]; withholdLocalized?: boolean }`
  - `restoreFieldSetData(fields, flattenedData, resolveLocale?, identity?, options?: RestoreOptions): RestoreResult`. The new fifth parameter is optional, so existing callers are unchanged.
- Rules (spec 4.1, 4.2, 4.2a):
  - Localized field, shared row, single-locale read: use the value unless a row for `resolveLocale` exists.
  - Localized field, shared row, map read: set the value under each `conversionLocales` entry that has no locale row. A locale row always wins.
  - Non-localized field: a shared row wins. Otherwise use the `sourceLocale` row. Ignore all other locale rows. If there is no source row, the field is absent.
  - Neither case pushes a warning.
  - `withholdLocalized: true`: drop every value of a currently localized field, including its shared row. Keep non-localized fields and apply the source-row rule to them.
  - The order of rows in `flattenedData` must not change any outcome.

- [ ] **Step 1: Write the failing tests**

  Name each test after its rule.
  - Single-locale `fr` read of `alt` (now localized) with only `{ alt, all, 'X' }` → `fields.alt === 'X'`, `warnings` empty.
  - Same with an added `{ alt, fr, 'Y' }`, in both row orders → `'Y'`.
  - Map read with `conversionLocales: ['en', 'fr']` and rows `{ all: 'X', fr: 'Y' }` → `{ en: 'X', fr: 'Y' }`.
  - Map read with `conversionLocales: ['en']` → `{ en: 'X' }`.
  - `title` (now shared), rows `en: 'E'`, `fr: 'F'`, `sourceLocale: 'en'`, read in `fr` → `'E'`. Read as a map → `'E'`.
  - Rows `all: 'S'`, `en: 'E'` → `'S'`.
  - Only `fr: 'F'`, `sourceLocale: 'en'` → `title` is absent, no warning.
  - With `withholdLocalized: true`: now-localized `alt` with a shared row is absent, and now-shared `title` with `en`/`fr` rows reads `'E'`.
  - The same toggles on a `richText` field (JSON value) and a `number` field return the stored value unchanged. This is Review Focus 3.
  - Regression: an array row with index `undefined` and a truncated group path still produce warnings (spec case 11).

- [ ] **Step 2: Run them to make sure they fail**

  Run: `cd packages/core && pnpm vitest run --mode=node src/storage/storage-restore-localized-toggle.test.node.ts`
  Expected: FAIL. The current code pushes "Received non-localized data…" warnings.

- [ ] **Step 3: Implement the rules in `restoreFieldData`**

  Precedence needs per-field state that survives row order. Collect a leaf's
  candidate rows first and decide once. Alternatively, record what kind of row
  produced the current `target` and let a higher-precedence row replace it.
  Thread `options` alongside `resolveLocale` through the group, array and blocks
  helpers.

- [ ] **Step 4: Run them to make sure they pass, then run the whole core suite**

  Run: `cd packages/core && pnpm vitest run --mode=node src/storage/`
  Expected: PASS, including the existing `storage-flatten-reconstruct.test.node.ts`.

- [ ] **Step 5: Commit** — `fix(core): converted rows written under a previous localized flag on restore`

## Task 4: Adapter reads (both adapters)

**Files:**
- Modify: `packages/db-postgres/src/modules/storage/storage-queries.ts` (`reconstructFromUnifiedRows`, around lines 760–850)
- Modify: `packages/db-mysql/src/modules/storage/storage-queries.ts` (its `reconstructFromUnifiedRows`, around lines 760–850)
- Modify: `packages/core/src/@types/db-types.ts` (`IDocumentQueries`: add `listVersionFieldLocales`)
- Modify: both adapters' query classes to implement it
- Test: `packages/db-conformance/src/suites/localized-toggle.ts`

**Interfaces:**
- Consumes: `RestoreOptions` and `restoreFieldSetData` (Task 3), `conversionLocales` and `VersionFieldLocale` (Task 2).
- Produces: `IDocumentQueries.listVersionFieldLocales(params: { document_version_id: string }): Promise<VersionFieldLocale[]>`. It returns the distinct `(field_path, locale)` pairs across all seven store tables (not `store_meta`), using the same UNION shape as `writeVersionLocaleLedger`. Task 5 calls it.
- Read wiring:
  - Pass `sourceLocale: floor` (already computed as `sourceLocale ?? this.defaultContentLocale`).
  - Pass `conversionLocales`:
    - full read: `conversionLocales(<locales of loaded rows>, floor)`;
    - projected read (`storeTypes` given): add `ledger.availableLocales` to the input (decision 7).
  - Replace the `decision.withholdLocalized` row filter with `withholdLocalized: decision.withholdLocalized`.

- [ ] **Step 1: Add conformance cases 1, 2, 5, 6, 8, 10 (read half), 11, 12 and 14**

  Use the spec's wording for each case as its test name and assertion.
  - Case 1 and case 6 call each of `getDocumentById` (strict), `getDocumentByPath`, `getDocumentByVersion`, `findDocuments` and `getDocumentsByDocumentIds`.
  - Case 14 seeds a partial `fr` value in a `number` field and projects only text fields.
  - Add a direct `listVersionFieldLocales` case: seed `title` (`en`, `fr`) and `alt` (`all`), and expect the three pairs in any order.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `pnpm --filter @byline/core build && cd packages/db-postgres && pnpm test:integration tests/conformance.integration.test.ts -t "Localized toggle"`
  Expected: FAIL on strict reads with `document reconstruction failed`.

- [ ] **Step 3: Implement in `@byline/db-postgres`, then run** (same command; expected: the read cases pass, and Task 1's `it.fails` still reproduces)

- [ ] **Step 4: Implement in `@byline/db-mysql`, then run**

  Run: `cd packages/db-mysql && pnpm test:integration tests/conformance.integration.test.ts -t "Localized toggle"`
  Expected: PASS.

- [ ] **Step 5: Run both adapters' full conformance and unit suites**

  Run `pnpm test:integration` and `pnpm test` in each adapter package.
  Expected: PASS. The `localeVisibility`, `localeFallback` and `unavailableBlocks` suites are the likeliest to regress.

- [ ] **Step 6: Commit** — `fix(db-adapters): read documents written under a previous localized flag`

## Task 5: Repair on save

**Files:**
- Modify: `packages/core/src/services/document-lifecycle/persistence.ts` (`persistExistingDocumentVersion`, and a new helper beside it)
- Modify: `packages/core/src/services/document-lifecycle/copy-to-locale.ts` (the no-op guard near line 152)
- Modify: `packages/core/src/services/singleton-lifecycle/internals.ts` (the `copyToLocale` no-op guard near line 153)
- Test: `packages/db-conformance/src/suites/localized-toggle.ts`

**Interfaces:**
- Consumes: `listVersionFieldLocales` (Task 4), `findLocalizationMismatches` (Task 2), and the existing `mergeWriteLocale`.
- Produces: `export async function versionHasLocalizationMismatch(ctx: DocumentLifecycleContext, versionId: string): Promise<boolean>` in `persistence.ts`. It calls `ctx.db.queries.documents.listVersionFieldLocales({ document_version_id: versionId })` and returns `findLocalizationMismatches(ctx.definition.fields, pairs).length > 0`. It is internal to `@byline/core/services`: do not add it to the package's public barrel.
- Behaviour in `persistExistingDocumentVersion`: for every write with `previousVersionId` and a `locale` other than `'all'`, compute `mismatch = await versionHasLocalizationMismatch(ctx, write.previousVersionId)`. The function has **two** unavailable-block guards today: the outer `previousRead?.unavailableBlocks?.length` check, and the inner `previous?.unavailableBlocks?.length` check after the `getDocumentByVersion({ locale: 'all' })` re-read. Replace both, so the merged write runs when `unavailableBlocks` is non-empty **or** `mismatch` is true. Leaving the inner guard in place would silently skip a mismatch-only merge. Do not add a `collection_version` shortcut (decision 13).
- Behaviour in the two copy-to-locale no-op guards: each returns `changed: false` before persistence when the merged data equals the baseline. After a toggle the reconstructed source and target values can already match, so the guard would leave the stale rows in place. Add `&& !(await versionHasLocalizationMismatch(ctx, <current version id>))` to each guard, so a document that needs repair is written. A genuinely clean document still returns `changed: false`.

- [ ] **Step 1: Add conformance cases 3, 4, 7, 10 (save half), 15, 16, 17, 18, 22, 23 and 24, plus the Review Focus tests**

  - Case 4 is the data-loss regression. Save `fr` after a shared-to-localized toggle, then expect `en` to keep the old shared value.
  - Case 18 spies on `getDocumentByVersion` with `vi.spyOn` and expects no call with `locale: 'all'`.
  - Case 22 seeds mixed rows directly through `createDocumentVersion` under the current definition, with `collectionVersion` equal to the context's version.
  - Case 24 runs with and without `_id`. Without `_id`, expect positional matching (B's `fr` value paired with A's `en` value) and comment it as the documented limitation in decision 14.
  - Review Focus 1: case 4 again through `updateDocumentWithPatches`.
  - Review Focus 2: case 4 again through `updateSingleton` on a singleton definition.
  - Review Focus 3: case 4 again for a `richText` and a `number` field.
  - Review Focus 4: after a shared-to-localized toggle, `copyToLocale` from `en` to `fr` with `overwrite: false` on a document complete in `fr`, whose merged values already equal the baseline. Expect a new version (`changed: true`), `en` unchanged, `fr` holding the old shared value, and no shared row left for the field. Then repeat on an untoggled document with the same values, and expect `changed: false` and no new version. Run both cases for a singleton through `copySingletonToLocale`.
  - Review Focus 5: case 16 for `items.N.meta.note`.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `pnpm --filter @byline/core build && cd packages/db-postgres && pnpm test:integration tests/conformance.integration.test.ts -t "Localized toggle"`
  Expected: FAIL on cases 4, 7, 16, 17 and 22–23 at minimum.

- [ ] **Step 3: Implement in `persistExistingDocumentVersion`**

- [ ] **Step 4: Run on both adapters, then run both full conformance suites**

  Expected: PASS. Task 1's `it.fails` still reproduces, because the bug has no toggle and so no mismatch.

- [ ] **Step 5: Confirm the callers**

  Run: `grep -rn "createDocumentVersion(" packages/core/src/services`
  Every hit must be either the inside of `persistence.ts`, a `locale: 'all'` write, or `delete-locale.ts`'s compacted branch, which also writes `locale: 'all'`. Record the list in the handoff.

- [ ] **Step 6: Commit** — `fix(core): repaired documents with localization mismatches on their next save`

## Task 6: Declaration-aware filters and sorts

**Files:**
- Modify: `packages/core/src/@types/db-types.ts` (`FieldFilter` and `FieldSort`: add `localized?: boolean`)
- Modify: `packages/core/src/query/parse-where.ts` (the field-filter branch near line 666 and `parseSort` near line 718: set `localized: field.localized === true`; relation sub-filters already parse against the target definition, so check that they carry it too)
- Modify: `packages/db-postgres/src/modules/storage/storage-queries.ts` (`buildFieldExists` near line 2659, and the sort join near line 2422)
- Modify: the MySQL equivalents in `packages/db-mysql/src/modules/storage/storage-queries.ts`
- Test: `packages/core/src/query/parse-where.test.node.ts`, `packages/db-conformance/src/suites/localized-toggle.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Arms (spec 4.4 table):
  - localized, not withheld: `locale = <effective> OR locale = 'all'` (unchanged);
  - localized, withheld (the effective locale is SQL `NULL`): `locale = <effective>` only;
  - not localized: `locale = 'all' OR locale = COALESCE(<document source_locale>, <default content locale>)`.
  - The sort `LATERAL` orders candidates by precedence before `LIMIT 1`: localized puts the effective-locale row first, and not-localized puts the shared row first. Where filters get no `NOT EXISTS` guard (decision 9).
  - `buildFieldExists` currently receives only `locale`. Give it the outer scope's source-locale SQL so the non-localized arm can correlate, the way `effectiveLocaleSql` already does.
- **Compatibility rule for an omitted flag.** `localized` is three-state in the adapters: `true` uses the localized arms, `false` uses the not-localized arms, and `undefined` uses exactly today's arms (`locale = <locale or effective> OR locale = 'all'`, with today's sort join). Callers that build `FieldFilter` and `FieldSort` by hand, including the existing `locale-query-semantics`, `find-documents-sort` and `document-tree` conformance suites, therefore behave as before. The parser always sets an explicit boolean.

- [ ] **Step 1: Write the failing parser tests**

  `parseWhere({ title: 'x' }, def)` yields a filter with `localized: true` for a localized `title`, and `localized: false` (asserted explicitly, not omitted) for a shared field, because an omitted flag selects the legacy SQL. Do the same for `parseSort` and for a relation sub-filter's nested filter.

- [ ] **Step 2: Add conformance cases 9, 13, 19, 20 and 21, plus the compatibility case**

  Compatibility case: a hand-built `FieldFilter` and `FieldSort` without `localized`, on a localized field with `en` and `fr` rows, read in `fr`, match and order exactly as they do on `develop` today (the `fr` row). Keep it separate from the parser-generated descriptors.

- [ ] **Step 3: Run both test sets to make sure they fail**

  Run: `cd packages/core && pnpm vitest run --mode=node src/query/parse-where.test.node.ts`
  Then rebuild core and run the conformance command with `-t "Localized toggle"`.
  Expected: FAIL.

- [ ] **Step 4: Implement the parser, then Postgres, then MySQL**

  Run each test set after each step. Expected: PASS.

- [ ] **Step 5: Run the full sort and filter suites on both adapters**

  Run `findDocumentsSort`, `localeQuerySemantics` and `localeVisibility`, by `-t` name or through the full integration run.
  Expected: PASS.

- [ ] **Step 6: Commit** — `fix(db-adapters): matched filters and sorts to the field's current localized flag`

## Task 7: Measure the save path

The storage benchmark harness (`benchmarks/storage/`, Postgres only) measures
reads only; it has no save scenario. The spec's phrase "the save benchmarks"
therefore means a scenario this task adds.

**Files:**
- Create: a save scenario in `benchmarks/storage/harness/` (follow `run-bench.ts`)
- Create: a results note in `benchmarks/storage/results/`, named like the existing ones

- [ ] **Step 1: Record the baseline commit**

  Record the commit the branch started from (the parent of Task 1's commit) in
  the handoff. This is the "before" implementation.

- [ ] **Step 2: Add the scenario**

  The scenario runs a single-locale `updateDocument` (locale `en`, one changed
  text field) against a seeded `bench-articles` document. Take the median of 50
  iterations after 10 warmup iterations, which is the harness's existing method.
  The harness requires a scale argument. From the repository root, following
  `benchmarks/storage/README.md`: seed with
  `pnpm tsx benchmarks/storage/harness/seed.ts --scale 10000` and run with
  `pnpm tsx benchmarks/storage/harness/run-bench.ts --scale 10000` (or the new
  scenario's script), using the same `--scale` for both.

- [ ] **Step 3: Measure before and after**

  1. Create a worktree at the baseline commit:
     `git worktree add ../bylinecms-bench-baseline <baseline-commit>`.
  2. Copy the new scenario file into the worktree's `benchmarks/storage/harness/`,
     so both checkouts run identical harness code.
  3. In each checkout, run `pnpm install` and
     `pnpm --filter @byline/core --filter @byline/db-postgres build`.
  4. Saves add versions, so re-seed immediately before each measured run, in
     both checkouts, against the same database and at the same `--scale`.
  5. Remove the worktree afterwards with `git worktree remove ../bylinecms-bench-baseline`.

- [ ] **Step 4: Record the results**

  Write both medians and the difference in the results note. If the median rises
  by more than 10%, stop and bring Tony the numbers. The spec prescribes no
  fallback, so how to respond is Tony's decision.

- [ ] **Step 5: Commit** — `perf(bench): added single-locale save scenario to the storage benchmarks`

## Task 8: Documentation

**Files:**
- Modify: `docs/03-architecture/01-document-storage.md` (property 2 near line 41, step 5 near line 83, per spec section 8)
- Modify: `docs/08-internationalization/index.md` (add a section on what editors and visitors see after a toggle: spec 4.7, the two display exceptions in section 1, and the translation work that copy-to-all creates)
- Modify: the `@byline/client` write documentation that covers single-locale `update` (find it with `grep -rln "update(" docs/05-reading-and-delivery`), stating that a single-locale write that removes or reorders array or block items must send each item's `_id` (decision 14)

- [ ] **Step 1: Write the changes**

  Use the `/document` skill's workflow and the house style in `CLAUDE.md`.

- [ ] **Step 2: Verify**

  Run: `pnpm docs:check && git diff --check`
  Expected: both clean.

- [ ] **Step 3: Commit** — `docs: documented localized-flag toggles and conversion on next save`

## Task 9: Changeset and full verification

**Files:**
- Create: a changeset under `.changeset/` for a patch release, describing the fix from the reader's side (toggling `localized` no longer breaks reads or loses values on save)

- [ ] **Step 1: Run the whole workspace**

  Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm byline:generate:check && pnpm knip && pnpm knip:exports`
  Expected: all clean. If `knip:exports` reports the new public exports from
  Tasks 2–4 (`findLocalizationMismatches`, `conversionLocales`,
  `VersionFieldLocale`, `LocalizationMismatch`, `RestoreOptions`), check that
  each one is meant to be public, then run `pnpm knip:exports:update` and commit
  the updated snapshot with this task.

- [ ] **Step 2: Check spec coverage**

  Walk spec section 5 cases 1–24 and the Review Focus list, and confirm each has a passing test. List any gaps in the handoff.

- [ ] **Step 3: Commit** — `chore: added changeset for localized-toggle fix`
