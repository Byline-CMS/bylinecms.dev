# Hand-written upgrade scripts (`sql/`)

This directory is the **Drizzle-independent** upgrade path for existing
production databases — the ones that do not run `drizzle:migrate` (after a
release squash the Drizzle journal no longer matches a deployed DB). It
mirrors `packages/db-postgres/sql/README.md`'s role and conventions.

Each Byline release squashes its Drizzle schema into the fresh-install
baseline bundled by `@byline/cli`. That baseline describes the target schema
from scratch; it is not an upgrade history and the CLI refuses to apply it to
an occupied database. To upgrade an existing installation, check out or browse
the Git tag for the target Byline release, read this directory in that tag, and
apply every numbered script you have not already applied, in filename order.
The CLI does not apply these scripts.

This directory can legitimately contain no numbered files when the current
release needs no MySQL schema change relative to the preceding release. Add a
script whenever an already-deployed schema needs an explicit step to reach a
new release.

When scripts do land, each should be numbered, idempotent, and applied by
hand as the application's DB role:

```sh
mysql -u byline -p byline_dev < packages/db-mysql/sql/0001_example.sql
```

## Conventions

- **Numbered.** Scripts apply in filename order (`0001_...`, `0002_...`),
  same as the Postgres stream.
- **Idempotent.** Each script should be safe to run more than once.
  `CREATE TABLE` and `CREATE INDEX` take `IF NOT EXISTS`; `DROP TABLE` /
  `DROP INDEX` take `IF EXISTS`. `ALTER TABLE` (adding a column, changing a
  type, adding a constraint, …) takes neither — MySQL has no
  `IF NOT EXISTS` form for any `ALTER TABLE` variant — so every `ALTER
  TABLE` guard needs an explicit `information_schema` check (e.g. query
  `information_schema.COLUMNS` for the column before adding it) so a
  re-run after a partial failure doesn't error out on work that already
  landed.
- **Transactional, with a MySQL-specific caveat.** Wrap the
  data-manipulation portions of a script in `START TRANSACTION` /
  `COMMIT` the same way the Postgres scripts do. But unlike Postgres,
  **MySQL DDL is not transactional** — every `CREATE TABLE`, `ALTER TABLE`,
  `CREATE INDEX`, `CREATE VIEW`, etc. statement causes an implicit commit
  and cannot be rolled back once it has run, regardless of any surrounding
  `START TRANSACTION`. In practice this means: if a script mixes DDL and
  DML, and a later statement fails, everything before the last DDL
  statement has already landed permanently. "Transactional" here can only
  promise atomicity for the DML portions; a failed script may leave partial
  DDL applied and require manual inspection and cleanup before re-running.
  Keep scripts small and single-purpose to minimize the blast radius of a
  partial failure.

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

The squashed Drizzle source under `src/database/migrations/` is maintained for
fresh baselines and adapter development. It connects over the same pool as the
application's DB role, so its objects are usable by construction. The rules
above apply only to this hand-written upgrade stream.
