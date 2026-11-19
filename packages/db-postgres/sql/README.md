# Hand-written upgrade scripts (`sql/`)

This historical hand-applied stream ends at **0015**. For an existing installation without a core journal, follow the native instructions in the target release tag, including the required backfills and writer fences. In shared databases review the ownership guard below before using any historical script. Use `byline storage status` to inspect the catalog and historical data. Once the database matches the checkpoint, fence writers and use `byline storage adopt` to record 0015.

Fresh installations now run the immutable SQL and manifest in [the adapter's migrations directory](../migrations/). The PostgreSQL adapter records checkpoint 15 in `public.byline_core_migrations`. Future numbered runner steps start at 0016. The separate `src/database/migrations/` directory belongs to Drizzle development tooling.

## Ownership guard

Prefer running these scripts **as the application's DB role**. When they are run
as a superuser (e.g. `postgres`) instead, any table they create is owned by that
superuser and the running server — which connects as the app role — hits
`permission denied`.

Every script that creates a table must therefore end, immediately before
`COMMIT`, with the canonical ownership guard. It reassigns every table and
sequence in `public` not already owned by the database owner (the app role, per
`CREATE DATABASE ... WITH OWNER <app_role>`) back to it, and no-ops when the app
role ran the script or nothing is mis-owned:

```sql
-- ---------------------------------------------------------------------------
-- byline:ownership-guard
-- ... (see any existing 000N script for the full comment)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  db_owner text := (
    SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()
  );
  obj record;
BEGIN
  IF current_user = db_owner THEN
    RETURN;
  END IF;
  FOR obj IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = db_owner)
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', obj.relname, db_owner);
  END LOOP;
END $$;
```

Keep the block **identical** across scripts — it names no table, so there is
nothing to customise. Because it converges *all* mis-owned public objects to the
database owner, it is safe to copy verbatim regardless of what the script
creates, and re-running it is always a no-op once ownership is correct.

This is enforced: `src/database/ownership-guard.test.node.ts` fails CI if any
script containing `CREATE TABLE` is missing the `-- byline:ownership-guard`
marker or the reassignment statement. Constraint-only scripts (no `CREATE
TABLE`) do not need the guard.

### Supervised SQL-only installation of checkpoint 0015

Use this procedure when a database operator needs a reviewable SQL file for a fresh installation. Fence application writers, workers, deployment jobs and host schema changes. Take and verify a database-wide backup that includes the host schema, roles and independent journals. Install the exact target release of the CLI and adapter. Use a direct session as the intended Byline object owner, with USAGE and CREATE on public, the pgcrypto extension installed, and the default or public search path.

From the release consumer, render and inspect the SQL. Set `TARGET_DATABASE` to the expected database name and configure libpq for its direct endpoint and migration identity through your usual secret mechanism. Run in a fresh psql session.

```sh
node node_modules/@byline/db-postgres/scripts/render-baseline.mjs > byline-0015.psql
psql -X --dbname="$TARGET_DATABASE" --set=byline_target="$TARGET_DATABASE" --file=byline-0015.psql
```

The file checks the database, server version, session settings, extension and schema privileges. It pins the search path, takes the adapter's bounded advisory lock, refuses occupied relations and types, installs the digest-verified baseline and verifies the relation inventory in one transaction. A statement error rolls back the transaction when psql exits. If the connection disappears during commit, keep the fence and inspect the database before retrying.

Keep the fence in place and set `BYLINE_DB_POSTGRES_CONNECTION_STRING` to the same direct target. Run `byline storage status --database postgres`. Expect `recognized` at 15 (exit 3). Inspect discrepancies before proceeding. Run `byline storage adopt --database postgres --yes`, then `byline storage status --database postgres`. The journal now records checkpoint 15 with adopted origin. Apply any pending suffix using the matching release, verify current status and application readiness with runtime credentials, then reopen traffic. Retain the backup until the deployment is accepted.
