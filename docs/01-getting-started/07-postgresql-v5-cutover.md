---
title: "PostgreSQL v5 Cutover"
path: "postgresql-v5-cutover"
summary: "Fence PostgreSQL writers, apply the document-revision upgrade, deploy Byline 5, and reopen writes safely."
---

# PostgreSQL v5 Cutover

Companions:
- [Upgrading to Byline 5](./06-upgrading-to-v5.md) — application changes, copied-script inventory and rollback boundary.
- [Scheduled publication](../11-scheduling/02-scheduled-publication.md) — reviewing schedules invalidated by the upgrade.
- [`@byline/db-postgres` upgrade scripts](https://github.com/Byline-CMS/bylinecms.dev/tree/develop/packages/db-postgres/sql) — obtain the scripts from the exact release tag you are deploying.

This runbook upgrades an occupied PostgreSQL installation. Replace the example
role and database names with values verified for that installation. Test the
procedure against a restored copy first and retain a backup that predates the
maintenance window.

Repository CI cannot perform the credential, session or deployment checks in
this document. Record their results in the installation's operational change
record.

## 1. Inventory and prepare

- Identify the database, current application role, schema/database owner,
  migration operator and the replacement v5 application role.
- Inventory every editor host, scheduler, worker, importer and external SDK
  integration. Update their source according to the [v5 guide](./06-upgrading-to-v5.md)
  before the window.
- Obtain `packages/db-postgres/sql/0010_document-revisions.sql` from the exact
  v5 release tag. Do not use the CLI/Drizzle fresh baseline on this database.
- Take and verify a database backup. Record document and schedule counts for
  comparison.
- Keep one tested operator connection whose role will remain able to alter the
  schema after the application role is fenced.

## 2. Pause and fence every writer

Stop incoming editorial requests and all background writers first. Then prevent
new sessions and terminate existing ones. Run equivalent statements through
your managed PostgreSQL control plane where direct role administration is not
available.

```sql
ALTER ROLE byline_v4_app NOLOGIN;
REVOKE CONNECT ON DATABASE byline FROM byline_v4_app;

SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'byline'
  AND usename = 'byline_v4_app'
  AND pid <> pg_backend_pid();
```

Verify that no old application session remains:

```sql
SELECT pid, usename, application_name, client_addr
FROM pg_stat_activity
WHERE datname = 'byline' AND usename = 'byline_v4_app';
```

If the old application role owns database or schema objects, transfer that
ownership to a durable operator/owner role before revoking its privileges.
`REASSIGN OWNED` affects every object owned by the role in the current database;
inspect the role's inventory and scope the operation deliberately.

```sql
REASSIGN OWNED BY byline_v4_app TO byline_owner;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM byline_v4_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM byline_v4_app;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM byline_v4_app;
```

Create or prepare a replacement login for v5 and grant only the privileges the
application requires. Do not give the replacement credentials to a running
process yet.

## 3. Apply the native upgrade

Run the numbered upgrade through the retained operator connection. `ON_ERROR_STOP`
is required so a failed assertion cannot be followed by later statements.

```sh
psql -X --set ON_ERROR_STOP=1 "$BYLINE_OPERATOR_DATABASE_URL" \
  --file packages/db-postgres/sql/0010_document-revisions.sql
```

The script executes in one PostgreSQL transaction. It adds and backfills
`byline_documents.revision`, adds schedule authorization revisions, invalidates
legacy armed schedules, and installs safe-integer constraints. A failure rolls
the script back. Diagnose the reported stage before rerunning it while the fence
remains in place.

Verify the target schema and absence of legacy armed schedules:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'byline_documents' AND column_name = 'revision')
    OR (table_name = 'byline_document_publish_schedules'
      AND column_name = 'authorized_revision'));

SELECT count(*) AS invalid_documents
FROM byline_documents
WHERE revision IS NULL OR revision < 1 OR revision > 9007199254740991;

SELECT count(*) AS legacy_armed_schedules
FROM byline_document_publish_schedules
WHERE state = 'armed' AND authorized_revision IS NULL;
```

Expect `revision` to be `bigint`, non-null and without a default;
`authorized_revision` to be nullable `bigint` without a default; and both counts
to be zero. Compare document and schedule totals with the pre-cutover record.

## 4. Deploy and verify while fenced

Deploy the complete v5 package set, updated copied scripts and all external
writers. Configure only the replacement application role. Start one application
instance with editor traffic and schedulers still disabled.

- Confirm startup accepts the revision-capable schema.
- Perform an authorized editable read and guarded test write on a designated
  non-production fixture, or use the installation's approved smoke procedure.
- Confirm an omitted revision is rejected rather than accepted.
- Confirm `byline_v4_app` cannot open a new connection and that
  `pg_stat_activity` contains no old session.
- Confirm only the replacement role is used by the new deployment.

## 5. Reopen writes

Restore editor traffic first, then workers and schedulers. Monitor database and
application errors. Open the scheduled-publication queue and explicitly review
every `needs_reconfirm` row marked `upgrade_invalidated`; do not bulk-authorize
them from the backfilled revision.

Keep the old role `NOLOGIN` and without write privileges. Once v5 has committed
writes, returning to a v4 writer is unsupported without another fenced recovery
procedure or a complete pre-upgrade database restore.

