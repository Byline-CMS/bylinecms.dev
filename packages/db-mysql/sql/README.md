# MySQL native upgrades through 0010

This directory preserves the hand-applied upgrade history through **0010**. For a legacy database, identify the release you run and follow its tagged upgrade instructions in filename order with writers fenced and a tested restore point. The frozen baseline in the adapter's `migrations/` directory is for a fresh installation.

MySQL 8.0.16 and later enforce the revision constraints. Dedicated setup creates `byline_core_migrations` and records the current installation and stage before applying baseline DDL. If the process stops, repeat the same setup with the existing database password. The adapter checks the entire observed prefix before continuing. A conflicting definition requires a scoped repair or fenced restore. Keep the complete database, including provider and host histories, in the restore point.

## Adopt an existing installation

Run `byline storage status --database mysql` on a restored copy. The migration identity needs schema-wide SELECT, SHOW VIEW and TRIGGER for unjournaled inspection. The adapter compares the effective columns, ordered keys, generated columns, enforced constraints, views and historical content. Native ALTER scripts append columns to existing tables. The adapter accepts equivalent column definitions in that physical order because its reads and writes reference columns by name. The order within each index and the output of each view remain part of the contract.

On MySQL 8.0.16, historical script 0005 can stop at its suspended-reason check because that server prints `ISNULL` where the script expects `IS NULL`. Preserve the source database and its restore point. Rehearse moving the legacy database to MySQL 8.0.46 and re-run 0005 before continuing through 0010. A complete 0010 schema can already be adopted on 8.0.16. Leave the released SQL intact.

The compatibility fixture starts at v4.10.2, applies 0001 through 0010 and checks path liveness, authorization revisions and historical version-locale coverage. An incomplete catalog or failed data check leaves the target untouched. With all writers and workers fenced and a verified restore point, run `byline storage adopt --database mysql --yes` using a migration identity with CREATE and INSERT. Adoption creates one completed baseline row. A repeated adoption verifies the checkpoint. A connection loss after journal creation requires repeating the operation and its evidence checks.

## Upgrade journaled storage

Run `byline storage status --database mysql` to see pending versions or an interrupted stage. With writers fenced, run `byline storage migrate --database mysql --yes`. Completed versions survive a later failure. The runner checks the full prefix on a new connection, including any DDL that committed before its receipt. Transactional backfills commit their data and progress together. A definition outside the supported prefix requires a scoped repair or a restore with the matching application.

For a release job, provide the paired runtime and direct migration URLs and the deployed adapter versions, then run `byline storage migrate --database mysql --online-only`. Each eligible step declares its tested server patches, writer releases, explicit DDL algorithm and lock limits. The published 6.13.4 writer fails its own revision check on MySQL 8.0.16, so it cannot qualify for an online rollout there. Use a fenced rollout for that combination. An applying row blocks promotion and new application or worker startup, even after the final DDL. Keep enough healthy instances to serve through that interval. Supervised recovery must finish before promotion resumes. Runtime accounts need content DML and journal SELECT. The owner of existing views must retain access to their dependencies. Search and analytics have separate grants and journals.

## No ownership guard

`packages/db-postgres/sql/README.md` documents a Postgres-specific
"ownership guard" block: running a script as a superuser instead of the
application's DB role leaves tables owned by that superuser, which the
running server (connecting as the app role) then can't use —
`permission denied`. **MySQL has no equivalent failure mode.** MySQL's
privilege model is grant-based, not object-owner-based: a table created by
any authenticated connection (root or otherwise) is usable by every role
that has been `GRANT`ed the relevant privilege on the database (see
`db-reset.sql.template`'s `GRANT ALL PRIVILEGES ON <db>.* TO '<app_user>'@'%'`).
There is no per-object "owner" that can starve the app role of access the
way Postgres's `OWNER` can, so scripts in this directory carry no
ownership-guard block, and none should be added.
