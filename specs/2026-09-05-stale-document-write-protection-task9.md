---
title: "Stale document write protection Task 9 evidence"
path: "stale-document-write-protection-task9"
summary: "Record admin conflict recovery, browser observations, regression evidence, and the R4 review boundary."
---

# Stale document write protection Task 9 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md)
- [Task 8 evidence](./2026-09-05-stale-document-write-protection-task8.md)
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md)

Date: 2026-09-06. Tasks 8–9 are implemented and submitted for R4 review. This is implementation evidence, not an independent review pass. Tasks 10–11, release, and migration squashing remain outstanding.

## Behavior and review targets

Collection and singleton editors retain their editable observation independently of background loader updates. Only a successful mutation receipt advances that observation. A persistent stale, missing-revision, lock-conflict, or unavailable-document warning blocks further mutations synchronously, including previously captured callbacks. Content remains available for inspection and copying. Save, metadata, status, scheduling, duplicate, delete, locale, and tree controls use the same block.

Explicit Reload document discards and reloads the entire editor. Ordinary navigation retains the unsaved-change guard. A failed reload restores that guard. Alerts receive focus and support keyboard activation. All eight shipped admin locale bundles include the messages. Generic failures do not expose driver diagnostics; committed hook warnings remain distinct from rejected mutations.

Lists, trees, history restoration, and scheduled-publication cancellation have persistent conflict handling. Structural receipts retain the authorized suspension summary and review link, including committed hook failures and delete responses. A failed refresh after a successful flat reorder now shows the existing committed-refresh warning without restoring the old order. Tree stale failures do not automatically refresh into a new observation.

Primary review files are `document-mutation-state.ts`, `form-renderer.tsx`, collection/singleton editor handlers, `document-mutation-errors.ts`, `structural-receipt.ts`, and their adjacent tests. The host HTTP tests use the installed TanStack Start handler and Seroval serialization, with manifest/request metadata supplied by the test harness. They are not merely direct calls to an error formatter.

## T9-1: metadata-only Save with a locale

The browser uncovered a real lifecycle defect: metadata-only Save passed the editor locale into the version-write guard, which then required a previous version ID. Path-only Save failed even with a valid document revision.

`system-fields.ts` now passes document identity and the expected document revision to the guard. Locale remains available to the metadata operation, which preserves canonical-path restrictions. No revision requirement was relaxed. Two conformance cases cover English and French metadata-only Save, unchanged version identity, one document revision advance, and a subsequent stale rejection with unchanged persisted state. Both tests failed on PostgreSQL before the fix and passed on both engines afterward. The red reproduction is `/tmp/byline-task9-metadata-red.log`.

## Direct browser walkthrough

The user started and signed into the shared development instance at `http://localhost:5173/`. Verification used two in-app browser tabs with independent route/form snapshots under the same authenticated account. These were not isolated authentication contexts or two different users. No permanent Playwright test was added.

A disposable Draft page was created at `/admin/collections/pages/01a07349-55fc-72b4-ac9f-cd16ad1aafd1`.

1. Both tabs loaded the same document. Alice saved a content change. Bob changed his older form and attempted Save. Bob received the persistent stale warning, retained his unsaved title, and had disabled Save, Publish, action-menu, path, and advertised-locale controls. A screenshot captured this state.
2. Bob's ordinary Cancel opened the unsaved-change confirmation. Stay retained his draft. Explicit Reload and discard loaded Alice's saved content without an extra navigation prompt. Bob then edited and saved successfully, demonstrating recovery.
3. After the T9-1 fix, both tabs loaded fresh observations. Alice changed only the path to `r4-concurrency-metadata-change` and saved through the metadata confirmation. Bob's older content Save was rejected as stale. His old path and unsaved content remained visible. Keyboard Tab reached Reload from the focused warning; Return reloaded the saved title and new path with a clean baseline.
4. Both tabs loaded fresh observations again. Alice changed only the advertised English locale and saved. Bob attempted Publish from his older, otherwise clean form. The stale warning appeared and the document remained Draft. A fresh read in Alice's tab confirmed the persisted Draft status, saved title, and path. A second screenshot captured the rejected Publish state.

The draft remains available for reviewer inspection. The user's shared server was left running. Structural schedule notices were verified by component and provider tests, not claimed as an additional live browser walkthrough.

## Verification

Commands ran from the repository root unless a package directory is stated. Temporary logs are local evidence and are not committed artifacts.

| Check | Result | Log under `/tmp/` |
| --- | --- | --- |
| `pnpm build:packages` | 21 tasks passed | `byline-task9-build.log` |
| `pnpm typecheck` | 44 tasks passed | `byline-task9-types.log` |
| Host package `typecheck`, after the final list change | Passed, including supplemental tests | `byline-task9-host-final-types.log` |
| Core package `test` | 1,109 passed | `byline-task9-core-tests.log` |
| Client package `test` | 146 passed | `byline-task9-client-unit.log` |
| Admin package `test` | 34 jsdom and 189 node passed | `byline-task9-admin-tests.log` |
| Host package `test` | 54 jsdom and 210 node passed | `byline-task9-host-tests.log` |
| i18n package `test` | 49 passed | `byline-task9-i18n-tests.log` |
| Provider unit tests | PostgreSQL 54; MySQL 331 passed | `byline-task9-postgres-unit.log`, `byline-task9-mysql-unit.log` |
| PostgreSQL package `test:integration` | 380 passed, 8 files | `byline-task9-postgres-full.log` |
| MySQL package `test:integration` | 401 passed, 11 files | `byline-task9-mysql-full.log` |
| Client package `test:integration` | 169 passed, 19 files; after PostgreSQL checks | `byline-task9-client-integration.log` |
| Concurrency repeats, each provider | 10 consecutive runs passed, 136 selected tests per run | `byline-task9-{postgres,mysql}-repeat-{1..10}.log` |
| `pnpm knip` | Clean | `byline-task9-knip.log` |
| `pnpm knip:exports` | 1,210 known entries; no new unconsumed exports | `byline-task9-exports.log` |
| `pnpm byline:generate:check` | 13 tasks passed; six collection types current | `byline-task9-generated.log` |
| Documentation check and `git diff --check` | Passed | `byline-task9-docs.log` |
| CLI package `check:templates` | Four dialect/flavor combinations passed against built packages | `byline-task9-templates.log` |

Repeat runs used the conformance test-name pattern `Task 7 scheduled and structural revisions|guarded lifecycle saves|byline_document_paths integration|document-tree lifecycle audit atomicity|document publish schedules`. Each run intentionally excluded 196 other conformance cases; the full suites above cover those. The runner bounded each command at 120 seconds, drained it on failure, and stopped a series on its first failure. Repetition supplements deterministic coordination; it does not prove absence of races.

Component tests cover the broader action matrix, late callback blocking, metadata observation retention, missing revision and unavailable states, lock failures on Save and Delete, dirty-state preservation, reload failure, focused warnings, and the authorized suspension review link. The final flat-reorder refresh correction was additionally typechecked; there is no dedicated browser reproduction of refresh failure.

## Local migration and diagnostic attempts

The initial browser startup exposed the pending generated PostgreSQL suspension-reason constraint migration. The existing Drizzle migration command applied `0002_tiny_callisto.sql` to local `byline_dev`, preserving the two original ledger rows and appending row 17 with hash `ec819b106b4717da158e60b5d6f2750f2003d7484af016b392c3f1bb3577daf9`. Document count was 186 before and immediately after migration, before the browser fixture was created. Command: from `packages/db-postgres`, `node --env-file=../../apps/webapp/.env.local node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.config.ts`. Log: `/tmp/byline-task9-dev-migration.log`. No squash, ledger rewrite, CLI baseline replacement, or release occurred.

Earlier diagnostic failures are not passing evidence: a temporary Playwright attempt lacked its browser executable and was removed; port 5173 initially served a different local app before the shared instance was established; metadata-only Save failed before T9-1; supplemental host test typechecking initially lacked the CSS ambient declaration; running host UI tests alongside a root build temporarily removed i18n build output. Those configuration/build-order issues were corrected and the affected checks rerun. A sandboxed generated-type check failed because tsx could not open its local IPC socket; its authorized rerun is recorded in the handoff checks.
