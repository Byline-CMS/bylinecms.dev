---
title: "Stale document write protection R2 handoff"
path: "stale-document-write-protection-r2"
summary: "Review coherent editable snapshots, reserved revision observations, SDK and admin read integration, and both providers' race evidence."
---

# Stale document write protection R2 handoff

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines Task 4 and the R2 gate.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the release behavior.
- [R0 contracts](./2026-09-05-stale-document-write-protection-r0.md) defines the explicit editable methods and read-only facade.
- [Client SDK API](../docs/10-api-reference/04-client-sdk.md) documents the implemented read surface and its current limits.

Date: 2026-09-05. Status: Task 4 implemented; R2 review requested, not passed. Task 5 has not started. The working tree also contains the previously reviewed R0/R1 work; no commit or release was created for this handoff.

## Scope and decisions

Task 4 uses the approved read-only repeatable-read strategy in both providers. The revision-bracket fallback was not needed. The shared D02 suite is implemented, together with the editable-read portion of A01 and the read-side host integration supporting H01. Mutation preconditions, scheduler authorization enforcement, stale-warning UI, and rollout remain later tasks.

`getTreeForEdit` supplements `getSubtreeForEdit` for the admin loader: the whole forest and the scoped unplaced-document list must share one structural snapshot. It pages the latter by document identity, rather than a potentially tied timestamp, and preserves the existing admin row scope. Ordinary public tree reads retain their existing path.

R1-1 remains open and non-blocking. No SQL migration, Drizzle ledger, schedule reason, or development database was changed during Task 4.

## Implementation to inspect

| Area | Source | Behavior |
| --- | --- | --- |
| Adapter contract | [Core database types](../packages/core/src/@types/db-types.ts) | Required `withReadSnapshot` and `ReadSnapshotQueries`; the document surface omits `getDocumentSystemFieldsForUpdate`. A narrow `getDocumentRevision` query reads the collection-scoped logical document. |
| Query facade | [Core facade](../packages/core/src/storage/read-snapshot.ts) | Explicit allowlists expose bound read methods only. No query-class fields, executor, write manager, locking method, or prototype escape is included. Nested schedule queries expose only `get` and `list`. All bound methods reject use after the callback ends. |
| Provider executors | [PostgreSQL](../packages/db-postgres/src/modules/storage/read-snapshot.ts), [MySQL](../packages/db-mysql/src/modules/storage/read-snapshot.ts) | Each opens a dedicated transaction with explicit `repeatable read` and `read only` settings. Document, collection, audit, singleton mapping, and nested schedule readers all use that executor. Ordinary query objects remain unchanged. The snapshot does not join an ambient write transaction. |
| Startup check | [Capability gate](../packages/core/src/storage/document-revision-capability.ts) | Missing snapshot support fails before schema checking and boot writes, including untyped adapters. |
| Collection reads | [Collection handle](../packages/client/src/collection-handle.ts), [types](../packages/client/src/types.ts) | `findByIdForEdit`, `findForEdit`, `getSubtreeForEdit`, and `getTreeForEdit` select current state with any-mode authorization. Raw source assembly, revision, and authorized schedule state share the snapshot. List selection stays selective. |
| Singleton reads | [Singleton handle](../packages/client/src/singleton-handle.ts), [private reader bridge](../packages/client/src/read-internals.ts) | `getForEdit` uses the same authorized collection read pipeline. Slot lookup and source reconstruction share one snapshot. Only an unmapped slot returns `state: 'empty'`; a hidden/deleted/inconsistent mapped document returns null. |
| Response integrity | [Collection handle](../packages/client/src/collection-handle.ts) | Before-read scoping finishes before the snapshot. Population and after-read hooks run after it closes. Identity, selected current version, workflow status, and revision are captured separately and restored as reserved observations. Field and optional metadata redaction still apply. A hook cannot inject a newer revision into older source content. |
| Admin document/list/tree | [Document loader](../packages/host-tanstack-start/src/server-fns/collections/get.ts), [list loader](../packages/host-tanstack-start/src/server-fns/collections/list.ts), [tree loader](../packages/host-tanstack-start/src/server-fns/collections/tree.ts) | Load through explicit edit methods; preserve revisions through schema parsing and tree-row shaping. Schedule controls use the captured schedule, not a later read. |
| Admin singleton | [Shared read](../packages/host-tanstack-start/src/server-fns/singleton-document-read.ts), [route loader](../packages/host-tanstack-start/src/routes/create-singleton-route.tsx) | Unavailable mapped documents raise not-found rather than initializing an empty form. A real empty slot returns `expectedEmpty: true` in the route result. Schedule aliases come from the editable observation. |
| Historical restore target | [Collection history route](../packages/host-tanstack-start/src/routes/create-collection-history-route.tsx), [singleton history route](../packages/host-tanstack-start/src/routes/create-singleton-history-route.tsx) | Existing history loaders fetch their current target independently through the now-editable current-document loader. Historical source rows remain token-free. Passing the target revision into the restore mutation belongs to the subsequent mutation/transport tasks. |
| API inventory | [SDK reference](../docs/10-api-reference/04-client-sdk.md), [checked API inventory](../apps/webapp/byline/scripts/lib/docs-api-surface.ts), [registered singleton surface test](../apps/webapp/byline/registered-client-types.test.node.ts) | Document and type-check the additive editable surface without changing generated collection field types. Seven intentional public SDK types were added to the export baseline. |

The informational published-version badge remains a separate read. It does not supply the current source status, revision, or scheduled-publication control state. Related documents retain existing population semantics rather than a cross-document transactional guarantee.

## Race and authorization evidence

[Shared editable-snapshot conformance](../packages/db-conformance/src/suites/editable-snapshots.ts) runs seven cases on each engine:

1. A content writer commits after source selection but before field reconstruction; the reader still returns the old version, fields, metadata, and revision together.
2. A status writer commits at that same boundary; the reader retains the original status and revision.
3. A path/advertised-locale writer commits at that boundary; the reader retains both original metadata values and revision.
4. A structural removal commits between tree selection and hydration; the original snapshot retains its topology and action rows, while a later snapshot sees removal.
5. A schedule is armed after source metadata selection; both nested schedule query methods retain the original observation, while a later snapshot sees the arm.
6. Another connection fills an empty singleton slot; the original snapshot remains empty, and the next snapshot sees the mapping.
7. Runtime and compile-time exclusion of locking reads, no exposed executor/manager fields, and expiry of escaped singleton/schedule methods.

The provider harness interposes the writer inside `DocumentQueries.getAllFieldValues`, after its source SELECT. It restores the spy in `finally`. The writer must commit before field reconstruction continues; this requires an independent connection while the snapshot connection remains occupied. There are no sleeps or retry loops. Vitest's finite integration timeout rejects stalled execution; timeouts are failures, not race evidence.

[SDK editable-read integration](../packages/client/tests/integration/client-editable-reads.integration.test.ts) adds nine cases: preserved revision/action identity under hook tampering; field and optional metadata redaction; selected list fields; public/history token absence with no snapshot/revision/schedule query overhead; JavaScript selector rejection; document/list/tree row scoping; failed reads without hook replay or payload; anonymous any-mode denial; explicit empty versus hidden singleton state; and placed/unplaced tree observations. Several assertions share a case.

Existing population, locale, tree, singleton, history, and authorization suites also ran as part of the complete SDK integration suite. Host tests cover the changed singleton delegation and captured schedule aliases. The core capability test now explicitly rejects an adapter missing `withReadSnapshot` before schema work.

## Verification

All database executions used local `_test` databases. PostgreSQL provider and SDK integrations ran serially because they share a database. PostgreSQL and MySQL provider suites used separate engines. No development or downstream migration was run.

| Command | Result |
| --- | --- |
| `pnpm --filter @byline/core test` | 60 files, 1,105 tests passed. |
| `pnpm --filter @byline/client test` | 12 files, 128 tests passed. |
| `pnpm --filter @byline/host-tanstack-start test` | jsdom: 6 files / 32 tests; node: 25 files / 157 tests; all passed. |
| `pnpm test:integration` from `packages/db-postgres` | 8 files, 276 tests passed; all seven snapshot cases included; no skipped tests. |
| `pnpm test:integration` from `packages/db-mysql` | 11 files, 301 tests passed; all seven snapshot cases included; no skipped tests. |
| `pnpm test:integration` from `packages/client` | 19 files, 166 tests passed, including nine new editable-read cases; no skipped tests. |
| `pnpm vitest run --mode=integration tests/conformance.integration.test.ts -t 'editable snapshots'` from each provider | Seven tests passed per engine. The focused runs deselected 225 unrelated tests; those ran in the full suites above. |
| `pnpm typecheck` | All 44 Turbo tasks passed, including required dependency builds and webapp API-surface checks. |
| `pnpm --filter @byline/db-conformance typecheck` | Passed. |
| Scoped `pnpm exec biome check --write --diagnostic-level=error` | Passed after formatting and correcting the type-only assertion. No repository-wide unsafe lint run. |
| `pnpm knip` | Passed. |
| `pnpm knip:exports` | Passed with 1,214 intentional baseline entries, seven more than R1. |
| `pnpm docs:check` | The tsx CLI could not open its IPC pipe in the sandbox (`EPERM`). The equivalent command below passed. |
| `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'` from `apps/webapp` | 69 documents / 692 links passed. |
| `git diff --check` and direct spec link/whitespace checks | Passed. |

A supplemental, non-gate `pnpm exec tsc --noEmit -p packages/client/tests/tsconfig.json` failed. That broader test tree contains stale search declarations, incomplete legacy adapter mocks (also missing the new snapshot contract), missing `pg` declarations, and unrelated strict-inference errors. No diagnostic named the new editable-read integration file. This command is not counted as passed; the configured package/root typechecks and executable integration suites above are the passing gates. This supplementary test-tree type cleanup remains outside Task 4.

Initial test failures were corrected rather than waived: adapters shape a missing path as an empty string, and lifecycle creation automatically places tree documents at a root, so the unplaced fixture now explicitly removes that placement. Root typechecking also caught exhaustive SDK inventories, which now include the new methods.

Provider node-only suites, Playwright, CLI artifact/template checks, and release-wide final gates were not rerun for this read-only task. Their later checkpoints remain required. The complete provider integration suites did rerun the R1 migration and revision-guard tests. Test logs for this session are under `/tmp/byline-r2-*` and are not committed artifacts.

## Requested review and stop condition

Trace an editable document in each provider through source selection, reconstruction, revision, schedule controls, callback expiry, and post-snapshot hooks. Check singleton ambiguity, list selection, the complete tree/unplaced snapshot, metadata redaction, and ordinary public defaults. Confirm that no mutation safety claim is inferred from the read foundation alone.

R2 is ready for independent review. Task 5 remains gated on a recorded R2 pass. R1-1 remains open; no later checkpoint, rollout, or release approval is implied.
