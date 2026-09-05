---
title: "Document revision R1 storage foundation handoff"
path: "document-revision-r1-storage-foundation"
summary: "Review the revision schema, resumable upgrades, guarded provider primitives, startup checks, and verified foundation evidence before editable reads are implemented."
---

# Document revision R1 storage foundation handoff

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md) defines the checkpoint sequence and coverage ledger.
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md) defines the complete concurrency guarantee.
- [R0 contracts](./2026-09-05-stale-document-write-protection-r0.md) records the approved API and transaction design.
- [Transactions](../docs/03-architecture/03-transactions.md) explains transaction ownership and savepoints.
- [Testing](../docs/13-testing.md) describes the database test environments.

## Review scope and status

Tasks 2–3 are implemented and ready for R1 review. **The reviewer verdict is pending.** Task 4 has not started. The implementation is an uncommitted working-tree diff against `0cc70cbfcf6117dcc4b20818ed5f6bc229a8bdd4`; include untracked files when reviewing it.

This checkpoint supplies storage foundations, not a releasable concurrency guarantee. Existing lifecycle mutations have not yet been routed through the revision coordinator. Editable snapshots, SDK precondition enforcement, scheduler/structural conversion, and admin stale-state recovery remain later checkpoints. No temporary unconditional-write option or mutation retry was introduced.

C01 error/number foundations and D01 provider primitives now have executable coverage. The migration/startup portion of M01 is implemented. These support the storage portions of spec criteria 2, 6, 14, 15, 17, and 18; they do not complete those criteria across SDK, host transport, maintenance operations, and the admin interface.

## Implementation to inspect

| Area | Source | Behavior |
| --- | --- | --- |
| Shared contracts and errors | [Revision types](../packages/core/src/@types/document-revision.ts), [number conversion](../packages/core/src/storage/document-revision.ts), [stale decoding](../packages/core/src/services/document-lifecycle/stale-document.ts) | Positive safe-integer inputs, checked driver values, dedicated stale variants, typed receipts, and selective lifecycle normalization of raw parent-stale conflicts. |
| Provider schema | [PostgreSQL](../packages/db-postgres/src/database/schema/index.ts), [MySQL](../packages/db-mysql/src/database/schema/index.ts) | Required document `BIGINT revision`, no default, range 1–9007199254740991; explicit revision 1 at document creation. Nullable schedule `authorized_revision` and the `document_metadata_changed` suspension reason. |
| Native upgrades | [PostgreSQL 0010](../packages/db-postgres/sql/0010_document-revisions.sql), [MySQL 0005](../packages/db-mysql/sql/0005_document-revisions.sql) | Add/backfill/tighten; suspend legacy armed schedules without authorization and clear their claims. Reruns preserve non-null counters and newly authorized schedules. |
| Development migrations | [PostgreSQL incremental](../packages/db-postgres/src/database/migrations/0001_glorious_nehzno.sql), [MySQL incremental](../packages/db-mysql/src/database/migrations/0001_sour_komodo.sql) | Generated snapshots/journals retained. Incremental SQL matches native SQL, except PostgreSQL's native outer transaction wrapper. No squash or CLI baseline replacement. |
| Transaction context | [PostgreSQL manager](../packages/db-postgres/src/lib/db-manager.ts), [MySQL manager](../packages/db-mysql/src/lib/db-manager.ts) | Context belongs to an adapter instance. Root transactions use read committed isolation; nested savepoints share lock ordering but have distinct observation lifetimes. |
| Guard primitives | [PostgreSQL revisions](../packages/db-postgres/src/modules/storage/document-revisions.ts), [MySQL revisions](../packages/db-mysql/src/modules/storage/document-revisions.ts) | Lock sorted canonical document identities, compare observed revision, reject unavailable documents, and preserve parent assertions under the lock. Return locked current content identity/status, source locale, path, and advertised locales. Guarded advance participates in the same transaction. |
| Startup validation | [Core capability gate](../packages/core/src/storage/document-revision-capability.ts), [PostgreSQL schema gate](../packages/db-postgres/src/lib/revision-schema.ts), [MySQL schema gate](../packages/db-mysql/src/lib/revision-schema.ts) | Required `IDbAdapter.revisions` capability; verify column types/defaults/nullability and complete enforced check expressions before collection reconciliation, counter setup, or boot maintenance. Errors identify the upgrade and fencing requirement. |

`revisions.lock` returns immutable, adapter-issued observations. `advance` rejects forged observations, observations from another transaction, and expired savepoint observations. A handle issued in an outer transaction remains usable inside a nested savepoint; a handle issued inside a savepoint expires when that savepoint ends, including successful release. A savepoint rollback can release its acquired row locks, so retaining those inner handles would be unsafe. A rolled-back advance does not poison an otherwise valid outer observation.

The adapter rejects concurrent lock requests within one transaction and later requests that reverse document identity order, including across savepoints. It does not yet enforce the collection/singleton/schedule portions of the universal lock order against every existing writer; those callers are converted in Tasks 5–7. A stale batch returns no observations to mutation code. A valid no-op does not advance, but an old precondition is rejected before no-op handling. Overflow fails before the revision update.

The public lifecycle rejection of externally owned transactions remains assigned to the lifecycle conversion. Raw storage savepoints remain supported. Neither this capability nor its schema check claims that all writers already advance revisions.

## Migration execution and resume protocol

For a downstream cutover, follow the specification's writer credential/session fencing procedure before running either native migration. Keep applications, workers, importers, and external integrations fenced after a failure. A successful migration alone does not authorize reopening writers before the complete compatible release is deployed and verified.

PostgreSQL native SQL runs in one transaction. Existing invalid data or incompatible column definitions abort the upgrade. Rerun after correcting the reported issue; do not apply a fresh baseline over occupied tables.

MySQL DDL commits implicitly. Run all statements sequentially on one connection and stop on the first error; never use `mysql --force` or a runner that continues after errors. There is no outer-transaction rollback claim. The supported recovery is forward resume by rerunning the same script after correcting the named stage; backup restoration remains an operator recovery procedure.

| MySQL stage | What to inspect | Resume behavior |
| --- | --- | --- |
| 1: columns | `information_schema.COLUMNS`: type, signedness, generated attributes, nullability and defaults for both revision columns. | Missing columns are added nullable. Incompatible definitions fail before data changes. A compatible partially added document column may retain a default until stage 5. |
| 2: suspension checks | Joined `TABLE_CONSTRAINTS` and `CHECK_CONSTRAINTS`: names, full clauses, and `ENFORCED`. | Accept only the expected old/new reason check and expected range checks. Replace the old reason check before writing the new reason. A same-named weaker constraint fails rather than being trusted. |
| 3: data transition | Document null revisions; armed schedules whose authorization is null; execution claim fields. | A transactional DML batch sets only null document revisions to 1 and suspends only legacy armed schedules without authorization. Existing counters and newly authorized schedules are preserved. |
| 4: data bounds | Null/invalid document revisions and non-null schedule authorization outside the safe range. | Stop with a stage diagnostic until the invalid data is corrected. Never clamp or reset an existing counter. |
| 5: tightening | Required document nullability, absent defaults, and range constraints. | Tighten only an incomplete compatible column; add only missing, previously validated checks. |
| 6: final verification | Both complete column definitions, all required enforced checks, and absence of legacy armed schedules without authorization. | A failure leaves the upgrade incomplete. Keep writers fenced, correct the reported state, and rerun. |

The SQL comments identify each stage. These read-only inspection queries show column/check state; use them before deciding how to repair a partial MySQL upgrade:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision')
    OR (TABLE_NAME = 'byline_document_publish_schedules' AND COLUMN_NAME = 'authorized_revision'));

SELECT t.TABLE_NAME, t.CONSTRAINT_NAME, t.ENFORCED, c.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS t
JOIN information_schema.CHECK_CONSTRAINTS c
  ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA
 AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
WHERE t.CONSTRAINT_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN ('byline_documents', 'byline_document_publish_schedules')
  AND t.CONSTRAINT_TYPE = 'CHECK';
```

MySQL does not permit preparing `SIGNAL`. The script therefore selects an intentionally unresolved, quoted diagnostic identifier on assertion failure. Its server error names the failed stage and remediation. This keeps the numbered file plain SQL without stored-routine/definer privileges or client-specific `DELIMITER` commands. Correct stages execute `DO 0`; every decision is recomputed from actual schema/data, not retained session variables or a completion marker.

## Evidence

Commands ran from the named package unless a root command is shown. Both integration suites ran serially within their own database. The final full runs have no skipped tests.

| Verification | Result |
| --- | --- |
| Core: `pnpm exec vitest run --mode=node --reporter=dot` | 60 files, **1,104 passed**. |
| Client: the same node-test command | 12 files, **128 passed**. |
| PostgreSQL: the same node-test command | 6 files, **46 passed**. |
| MySQL: the same node-test command | 5 files, **324 passed**. |
| PostgreSQL: `pnpm test:integration --reporter=dot` | 8 files, **269 passed**. |
| MySQL: `pnpm test:integration --reporter=dot` | 11 files, **294 passed**. |
| Core and both providers: `pnpm build` | Passed. |
| Core, client, both providers, and db-conformance: package `typecheck` | Passed. |
| Root: `pnpm typecheck` | **44 successful Turbo tasks**, including the webapp and dependency builds. |
| Root: `pnpm knip` | Passed. |
| Root: `pnpm check:native-sql-history --base v4.19.0` | All **13 released scripts** byte-for-byte unchanged. |
| Root: `pnpm knip:exports` | Passed, **1,207 known entries**, no new unconsumed exports. Six Task 2 entries became consumed and were pruned. |
| Scoped Biome and `git diff --check` | Passed at the configured error level. No generated migration metadata was hand-formatted. |
| Documentation validation | `pnpm docs:check` hit the known tsx IPC `EPERM`; the equivalent `node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'` from `apps/webapp` passed: **69 documents / 692 links**. The four specification documents were separately checked for front matter/H1 agreement, relative links, newlines, and whitespace. |

[Shared D01 tests](../packages/db-conformance/src/suites/document-revisions.ts) register **15 cases per engine**, including stale/no-op, missing/deleted targets, parent conflicts, batch failure, numeric boundary/overflow, metadata rollback, savepoints, observation lifetime, and ordered locking. Race tests hold the first document lock until the competing transaction has started and two physical connections are checked out. They prove stale rejection after a first commit and successful acquisition of the original revision after a first rollback. Barriers have explicit timeouts; a timeout fails the test.

The [PostgreSQL migration suite](../packages/db-postgres/tests/document-revision-migration.integration.test.ts) has **9 cases**, and the [MySQL suite](../packages/db-mysql/tests/document-revision-migration.integration.test.ts) has **10 cases**. They cover occupied fixtures, full fresh schema construction from the actual retained baseline plus incremental SQL, native/incremental equivalence, reruns, compatible partial columns/default removal, incompatible definitions, and startup rejection. MySQL interrupts after every DDL execution and committed DML boundary, closes the connection, reconnects, and reruns. PostgreSQL verifies rollback of occupied data on failure.

The migration tests demonstrate both sides of the old-writer boundary: inserts that omit revision fail, but old SQL updates can still change existing rows without advancing it. Database defaults/constraints cannot replace deployment fencing. Tests use isolated fixtures in `_test` databases; startup rejection cases temporarily alter and restore the test schema. No production credential or session fencing is claimed as tested.

Earlier failed runs exposed fixture setup mistakes (collection result shape, MySQL catalogue casing/escaped expressions, and algorithm-qualified view cleanup). Those were corrected and the final full suites rerun. Initial sandboxed database access failed with loopback `EPERM`; approved local database execution completed. No failed or timed-out run is counted as a pass.

## Local development migration record

The provider `.env` files identify separate local PostgreSQL and MySQL databases both named `byline_dev`, at ports 5432 and 3306 respectively. Read-only checks found zero other sessions in each target database before migration. The existing `pnpm drizzle:migrate` scripts ran with the respective environment loaded, guarded to local `_dev` targets. This local development operation is separate from downstream credential/session fencing acceptance.

| Database | Document count before/after | Existing ledger entry preserved | Incremental entry appended |
| --- | --- | --- | --- |
| PostgreSQL `127.0.0.1:5432/byline_dev` | **186 / 186** | ID 15; timestamp `1787797717481`; hash `6e2a7955618037bb270fd1d27003d148e2df46ad035de26602ef90de0606aa48` | ID 16; timestamp `1788587460302`; hash `d90e0f4f42885585a5695a37c4bdb21251638cdd6b09c105fc9008659bcba892` |
| MySQL `127.0.0.1:3306/byline_dev` | **2 / 2** | ID 9; timestamp `1787797706202`; hash `3a68987938e70ebfc96e99ca6ebcd31446f8a0fae6fce2422c0b340525afa78f` | ID 10; timestamp `1788587460314`; hash `2c1792ab552bbd76b846ed871f2e0e7eecb937fad2623e56acef3cb67821684b` |

Both resulting development schemas pass the provider startup validator, all document revisions are 1, and each appended migration hash exactly matches its current incremental file. The original ledger entries were not rewritten. No squash, downstream ledger edit, or CLI migration-template replacement occurred; those remain Task 10's reviewed work.

## Reviewer focus and remaining gates

Review the actual transaction executors, savepoint observation expiry, stable document lock order, no-default/range checks, and MySQL stage validation/resume behavior. Confirm the native/incremental equivalence and the explicit boundary between storage tests and operator fencing.

No implementation finding is being carried as an approved exception. R1 approval belongs to the reviewing agent. After a pass, Task 4 adds coherent editable snapshots; mutation integration remains gated on R2. SDK/host enforcement, admin browser behavior, worker/structural races, copied maintenance-script equivalence, CLI baseline/template checks, and production cutover checks have not been claimed at R1 and remain assigned to later tasks.
