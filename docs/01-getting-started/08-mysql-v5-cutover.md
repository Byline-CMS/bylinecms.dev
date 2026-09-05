---
title: "MySQL v5 Cutover"
path: "mysql-v5-cutover"
summary: "Fence MySQL writers, apply the resumable document-revision upgrade, deploy Byline 5, and reopen writes safely."
---

# MySQL v5 Cutover

Companions:
- [Upgrading to Byline 5](./06-upgrading-to-v5.md) — application changes, copied-script inventory and rollback boundary.
- [Scheduled publication](../11-scheduling/02-scheduled-publication.md) — reviewing schedules invalidated by the upgrade.
- [`@byline/db-mysql` upgrade scripts](https://github.com/Byline-CMS/bylinecms.dev/tree/develop/packages/db-mysql/sql) — obtain the scripts from the exact release tag you are deploying.

This runbook upgrades an occupied MySQL 8 installation. Replace the example
account host and database names with values verified for that installation.
Test the procedure against a restored copy first and retain a backup that
predates the maintenance window.

Repository CI cannot perform the credential, session or deployment checks in
this document. Record their results in the installation's operational change
record.

## 1. Inventory and prepare

- Identify the database, exact current application account including its host
  part, migration operator and replacement v5 account.
- Inventory every editor host, scheduler, worker, importer and external SDK
  integration. Update their source according to the [v5 guide](./06-upgrading-to-v5.md)
  before the window.
- Obtain `packages/db-mysql/sql/0005_document-revisions.sql` from the exact v5
  release tag. Do not use the CLI/Drizzle fresh baseline on this database.
- Take and verify a database backup. Record document and schedule counts for
  comparison.
- Keep one tested operator connection with schema-alter and account-management
  privileges after the application account is fenced.

## 2. Pause and fence every writer

Stop incoming editorial requests and all background writers first. Lock the old
account and remove its database privileges so it cannot establish another
writer session. Changing its password alone is insufficient because established
sessions remain usable.

```sql
ALTER USER 'byline_v4_app'@'%' ACCOUNT LOCK;
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'byline_v4_app'@'%';
```

List connections for that exact account and terminate every returned process ID
from the operator connection:

```sql
SELECT ID, USER, HOST, DB, COMMAND
FROM information_schema.PROCESSLIST
WHERE USER = 'byline_v4_app';

-- Run once for each returned ID:
KILL 12345;
```

Repeat the query until it returns no row. MySQL privileges are grant-based, so
there is no PostgreSQL-style object ownership transfer. Create or prepare a
replacement v5 account and grant only the privileges the application requires.
Do not give its credentials to a running process yet.

## 3. Apply the native upgrade

Run the numbered script through the retained operator connection. Do not use
`mysql --force`; the client must stop at the first error.

```sh
mysql --show-warnings --database="$BYLINE_DATABASE" \
  --host="$BYLINE_DATABASE_HOST" --user="$BYLINE_OPERATOR_USER" --password \
  < packages/db-mysql/sql/0005_document-revisions.sql
```

MySQL DDL commits implicitly. A failed run may therefore leave an earlier stage
applied even though later work did not complete. The script is designed for
that boundary: each stage inspects the actual schema and data, and the full
script is safe to rerun while writers remain fenced. It does not trust a
separate progress marker. Diagnose the named stage, correct the incompatible
state, and rerun the entire file until its final validation succeeds.

Verify the target schema and absence of legacy armed schedules:

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE,
       IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision')
    OR (TABLE_NAME = 'byline_document_publish_schedules'
      AND COLUMN_NAME = 'authorized_revision'));

SELECT count(*) AS invalid_documents
FROM byline_documents
WHERE revision IS NULL OR revision < 1 OR revision > 9007199254740991;

SELECT count(*) AS legacy_armed_schedules
FROM byline_document_publish_schedules
WHERE state = 'armed' AND authorized_revision IS NULL;
```

Expect signed `bigint` columns with no generated expression or default;
`revision` is non-null and `authorized_revision` is nullable. Both counts must
be zero. Confirm the three revision/suspension check constraints exist and are
enforced in `information_schema.TABLE_CONSTRAINTS` and
`information_schema.CHECK_CONSTRAINTS`. Compare document and schedule totals
with the pre-cutover record.

## 4. Deploy and verify while fenced

Deploy the complete v5 package set, updated copied scripts and all external
writers. Configure only the replacement application account. Start one
application instance with editor traffic and schedulers still disabled.

- Confirm startup accepts the revision-capable schema.
- Perform an authorized editable read and guarded test write on a designated
  non-production fixture, or use the installation's approved smoke procedure.
- Confirm an omitted revision is rejected rather than accepted.
- Confirm the locked old account cannot open a new connection and that the
  process list contains no old session.
- Confirm only the replacement account is used by the new deployment.

## 5. Reopen writes

Restore editor traffic first, then workers and schedulers. Monitor database and
application errors. Open the scheduled-publication queue and explicitly review
every `needs_reconfirm` row marked `upgrade_invalidated`; do not bulk-authorize
them from the backfilled revision.

Keep the old account locked and without write privileges. Once v5 has committed
writes, returning to a v4 writer is unsupported without another fenced recovery
procedure or a complete pre-upgrade database restore.

