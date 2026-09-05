---
title: "Stale document write protection Task 8 evidence"
path: "stale-document-write-protection-task8"
summary: "SDK, host transport, adapter-double and copied-script evidence prepared for the combined R4 review."
---

# Stale document write protection Task 8 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines Tasks 8–9 and R4.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the concurrency contract.
- [Task 7 evidence](./2026-09-05-stale-document-write-protection-task7.md) records the preceding enforcement checkpoint.

Task 8 is implemented and verified. This is implementation evidence, not an independent R4 pass. Task 9 still owns persistent editor state, recovery, structural notices and browser evidence.

## Changes

- The SDK's standard `typecheck` now includes its entire test tree. R2-1's 103 diagnostics are resolved: complete typed adapter doubles, correctly typed mock returns, current search declarations, optional fixture observations, selection assertions, and concrete PostgreSQL fixture types replace the incompatible fixtures and pool casts.
- Core and SDK unit doubles use complete contract-checked adapters whose unused operations throw. Transactions and snapshots are never supplied as successful pass-through defaults. Tests that exercise them provide explicit implementations; real-adapter suites remain the transaction ownership/rollback evidence. Nested empty schedule casts and unchecked adapter assertions were removed across core, SDK and host fixtures. Deliberately malformed JavaScript capability inputs remain explicit runtime-negative tests. Logger/core/container assertions and database-test teardown casts are not represented as adapter-contract evidence.
- Twenty compile-time omission assertions and eighteen raw JavaScript SDK mutation cases cover collection and singleton saves, statuses, schedules, restore, delete, locale copy and tree controls. Missing tree options now reach revision validation instead of failing on unchecked property access.
- The host wraps document mutations in a validated plain-data error boundary. Stale variants, old-client revision validation, confirmed lock failures and committed-hook warnings retain their typed details without causes, SQL, or hook diagnostics. Singleton save is included despite its precondition being expressed through a union type. Creation returns its revision receipt.
- Thirty-five raw host cases execute real exported save, metadata, status, unpublish and delete handlers and core validation. Missing, null, string, zero, negative, fractional and unsafe revisions reject before opening a write transaction. The harness supplies compiler binding, collection lookup and request authority; it does not replace lifecycle services.
- Eleven transport cases exercise the installed TanStack Start HTTP handler and Seroval protocol, supplying manifest lookup and request-local response context. All three stale variants, both revision validation reasons, confirmed lock conflicts, committed-hook warnings and safe-integer receipts round-trip. This is actual HTTP serialization code, not a JSON-only error test. Compiled application actions and independent browsers remain Task 9/R4 evidence.
- Host response helpers reattach a revision only to the matching document and version. Lists bind by identity rather than array position; historical, filtered-out and mismatched records reject. Populated targets receive no source token. Four tests cover these boundaries.
- The template compiler now checks copied import, media-regeneration and re-anchor scripts against built package exports. It found missing preconditions in the copied docs importer. Both importers now carry the final workflow transition's receipt into subsequent tree placement; three tests prove propagation, no-op preservation and conflict termination without retry. SDK documentation examples were converted to explicit observations and successful receipts.

## Verification

| Check | Result |
| --- | --- |
| Package build | 21 packages passed |
| Root `pnpm typecheck` | 44 tasks passed; includes SDK test tree and targeted host boundary tests |
| SDK unit suite | 146 tests passed |
| SDK PostgreSQL integration suite | 169 tests passed, 19 files |
| Core unit suite | 1,109 tests passed |
| Host jsdom suite | 33 tests passed |
| Host node suite | 206 tests passed |
| Import workflow tests | 3 tests passed |
| `pnpm --filter @byline/cli check:templates` | All four provider/flavor variants passed, including maintenance scripts |
| Knip | Passed |
| Public exports | 1,210 known entries; six newly consumed entries pruned |
| Documentation | 69 documents / 693 links passed |
| Changed-file Biome and `git diff --check` | Passed |

The first SDK integration attempt was denied local database access by the sandbox and ran no tests. The authorized rerun against the test database passed. Diagnostic runs exposed incomplete fixture behavior, a transaction-spy binding mismatch, template omissions and a built CSS import issue in host tests; these failures are not passing evidence. The corrected host Vitest setup transforms the built React package graph rather than sending Vite filesystem URLs to Node. A legacy host assertion requiring error-object identity was replaced by safe-wire-detail assertions, corroborated by the separate HTTP serialization suite.

No provider SQL or migration history changed. No additional provider race repetitions, browser runs, development-ledger changes, squash, release or push are claimed by Task 8. The ten-repeat policy remains required at R4 for affected concurrency suites. R2-1 is implemented as closed, pending independent R4 confirmation; Task 9's lock-failure presentation remains open.
