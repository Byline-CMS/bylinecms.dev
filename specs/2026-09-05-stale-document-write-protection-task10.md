---
title: "Stale document write protection Task 10 evidence"
path: "stale-document-write-protection-task10"
summary: "Record the v5 runbooks, squashed baselines, development-ledger reconciliation, copied-script checks, and release artifacts."
---

# Stale document write protection Task 10 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md)
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md)
- [Upgrading from 4.19 to 5.x](../docs/01-getting-started/06-upgrading-to-v5.md)

Date: 2026-09-06. Task 10 is implemented and submitted with Task 11 for R5
review. This record does not authorize package publication or a production
cutover.

## Upgrade and operator documentation

The v5 guide documents document-wide revisions, editable observations, every
required SDK write precondition, stale-editor recovery, schedule
reconfirmation, old-browser rejection, copied-source inventory, translation
cost, and the unsupported mixed-writer and rollback boundary. PostgreSQL and
MySQL have separate cutover runbooks with provider-specific credential fences,
session termination, operator ownership, native upgrade execution, schema
verification, deployment, and controlled reopening steps.

The runbooks explicitly distinguish repository evidence from installation
evidence. CI cannot prove that an operator revoked credentials, terminated
sessions, found every downstream script, verified a backup, or reviewed
invalidated schedules. A password change or non-null column alone does not
fence an already connected v4 writer.

The copied-source checklist names `regenerate-media.ts`,
`regenerate-media-operation.ts`, PostgreSQL `re-anchor.ts`,
`backfill-version-locales.ts`, `import-docs.ts`, `walk-document-status.ts`,
seeds, one-off jobs, and external SDK integrations. The CLI unit suite now
requires byte-for-byte equality for both media files, `re-anchor.ts`, and the
singleton seed between the web application and the corresponding template.
Import workflows retain their separate behavioral tests because the
application and template callers have deliberate configuration differences.

## Squashed baselines and CLI artifacts

The reviewed development Drizzle chains were squashed to one fresh baseline
per provider:

| Provider | Development baseline | SHA-256 | CLI copy |
| --- | --- | --- | --- |
| PostgreSQL | `0000_yielding_vulture.sql` | `1ad73a25adcf778663ba06ae4fd704c50aed39f5f33b6a87cdda3a0c9d31c16c` | Exact bytes and exact journal entry |
| MySQL | `0000_pale_bastion.sql` | `6e7ca60ab45a70c72b6e2fbfba35cfda1ee97ba2887ea891b9e2efd13a6b7f2f` | Exact bytes and exact journal entry |

`pnpm --filter @byline/cli sync:baselines` copied those files and journals into
the CLI. The baseline-drift test rejects missing, extra, renamed, byte-different
or journal-different files. The package artifact check found all four expected
baseline artifacts and no Drizzle snapshots. Template compilation passed all
four provider/flavour combinations.

The CLI database-install integration created new empty PostgreSQL and MySQL
databases, applied the bundled baseline, and verified a complete Byline schema.
It now additionally asserts that `byline_documents.revision` is a non-null
`bigint` with no default and that schedule `authorized_revision` is a nullable
`bigint` with no default. Both dialect cases passed. After clean `_test`
initialization, the provider migration suites separately built isolated full
schemas from their single development baselines and asserted both columns.
These fresh-install runs are the baseline-from-scratch proof; the development
ledger repair below is not used as that proof.

The numbered downstream upgrade streams remain separate and unchanged:
PostgreSQL retains `0001` through `0010`, and MySQL retains `0001` through
`0005`. `pnpm check:native-sql-history --base v4.19.0` verified all 13 scripts
that existed at the previous release tag byte-for-byte.

## Development database ledger reconciliation

Both local provider `.env` files identify distinct databases named
`127.0.0.1/byline_dev`, on PostgreSQL port 5432 and MySQL port 3306. The user
completed a manual bookkeeping reconciliation after the squash. It changed the
Drizzle ledgers to describe the already-current schemas without applying the
fresh baseline to occupied databases and without changing content.

| Database | Before reconciliation | After reconciliation | Content check |
| --- | --- | --- | --- |
| PostgreSQL `127.0.0.1:5432/byline_dev` | IDs 15–17: original baseline `6e2a7955618037bb270fd1d27003d148e2df46ad035de26602ef90de0606aa48`, revision migration `d90e0f4f42885585a5695a37c4bdb21251638cdd6b09c105fc9008659bcba892`, and Task 9 schedule-reason migration `ec819b106b4717da158e60b5d6f2750f2003d7484af016b392c3f1bb3577daf9` | ID 18, timestamp `1788642365591`, hash `1ad73a25adcf778663ba06ae4fd704c50aed39f5f33b6a87cdda3a0c9d31c16c`, exactly matching `0000_yielding_vulture.sql` | 187 documents; 0 schedules; no content change reported during reconciliation |
| MySQL `127.0.0.1:3306/byline_dev` | IDs 9–10: original baseline `3a68987938e70ebfc96e99ca6ebcd31446f8a0fae6fce2422c0b340525afa78f` and revision migration `2c1792ab552bbd76b846ed871f2e0e7eecb937fad2623e56acef3cb67821684b` | ID 11, timestamp `1788642356080`, hash `6e7ca60ab45a70c72b6e2fbfba35cfda1ee97ba2887ea891b9e2efd13a6b7f2f`, exactly matching `0000_pale_bastion.sql` | 2 documents; 0 schedules; no content change reported during reconciliation |

Task 9 applied its `0002` schedule-reason migration only to PostgreSQL dev.
MySQL dev never received the counterpart and remained one constraint change
behind until this reconciliation. That omission had no data impact because its
two documents had no schedules. The current MySQL baseline contains the final
constraint.

This reconciliation was hand-written ledger bookkeeping, not a
Drizzle-authored migration and not downstream guidance. Downstream
installations must never rewrite their migration ledgers; they use the numbered
native upgrade and fenced runbook. The exact complete pre-reconciliation
PostgreSQL rows are preserved in the Task 9 and R1 evidence, and the MySQL rows
are preserved in R1.

## Release note and verification

`.changeset/calm-documents-check.md` requests a coordinated major release for
`@byline/admin`, `@byline/cli`, `@byline/client`, `@byline/core`, both database
providers, `@byline/host-tanstack-start`, and `@byline/i18n`. Changesets resolves
the repository's fixed public-package group from 4.19.0 to 5.0.0. The note
calls out mandatory revision preconditions, editor recovery, provider cutovers,
the fresh CLI baseline, and copied-script updates.

| Check | Result |
| --- | --- |
| CLI unit suite, including baseline and copied-script drift | 357 passed in 29 files |
| CLI database-install integration | 2 passed; fresh empty database per dialect |
| CLI typecheck | Passed |
| CLI template compiler | Four provider/flavour combinations passed |
| CLI package artifact | Four baseline files present; no snapshots |
| PostgreSQL integration after clean `_test` setup | 380 passed in 8 files |
| MySQL integration after clean `_test` setup | 400 passed in 11 files |
| Client PostgreSQL integration | 169 passed in 19 files |
| Package build | 21 of 21 tasks passed |
| Documentation | 72 documents and 708 links passed before the final evidence documents |
| Native SQL history | 13 released scripts unchanged since `v4.19.0` |

The first PostgreSQL integration invocation was blocked by the filesystem
sandbox before opening a database connection and ran no tests. The authorized
rerun produced the result above. An initial native-history invocation used the
wrong option spelling and printed usage; the corrected `--base v4.19.0` command
passed. Neither diagnostic attempt is passing evidence.
