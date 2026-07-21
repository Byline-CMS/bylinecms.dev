# Hand-written upgrade scripts (`sql/`)

These numbered `.sql` scripts are the **Drizzle-independent** upgrade path for
existing production databases — the ones that do not run `drizzle:migrate`
(after a release squash the Drizzle journal no longer matches a deployed DB).
Each is idempotent, wrapped in a single transaction, and applied by hand:

```sh
psql "$DATABASE_URL" -f packages/db-postgres/sql/0005_add-admin-user-preferences.sql
```

The Drizzle stream (`src/database/migrations/`, run via `drizzle:migrate`) and
`@byline/search-postgres` (`migrate(pool)`) both connect over a pool as the
application's DB role, so their objects are owned correctly by construction.
The rules below apply only to this hand-written stream.

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
