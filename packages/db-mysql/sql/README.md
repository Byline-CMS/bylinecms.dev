# MySQL native upgrades through 0010

This directory preserves the hand-applied upgrade history through **0010**. For a legacy database, identify the release you run and follow its tagged upgrade instructions in filename order with writers fenced and a tested restore point. The frozen baseline in the adapter's `migrations/` directory is for a fresh installation.

MySQL 8.0.16 and later enforce the revision constraints. Dedicated setup creates `byline_core_migrations` and records the current installation and stage before applying baseline DDL. If the process stops, repeat the same setup with the existing database password. The adapter checks the entire observed prefix before continuing. A conflicting definition requires a scoped repair or fenced restore. Keep the complete database, including provider and host histories, in the restore point.

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
