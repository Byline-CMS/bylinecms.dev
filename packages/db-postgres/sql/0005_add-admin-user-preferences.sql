-- =============================================================================
-- Byline: per-user admin preferences  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds `byline_admin_user_preferences` — a scoped per-user key-value store
-- (sticky list-view page size / sort, and future admin-surface preferences).
-- Drizzle-independent equivalent of the schema delta in
-- packages/db-postgres/src/database/schema/auth.ts, for an existing
-- production database that does not run `drizzle:migrate`.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0005_add-admin-user-preferences.sql
--
-- Idempotent: guarded on the table's absence. Runs in one transaction.
--
-- Safe to run as either the application's DB role OR a superuser: the final step
-- reassigns the table to the database owner (the app role), so the running
-- server can always read/write it.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "byline_admin_user_preferences" (
  "user_id" uuid NOT NULL,
  "scope" varchar(255) NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "byline_admin_user_preferences_user_id_scope_pk"
    PRIMARY KEY ("user_id", "scope")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'byline_admin_user_preferences'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE "byline_admin_user_preferences"
      ADD CONSTRAINT "byline_admin_user_preferences_user_id_byline_admin_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "byline_admin_users"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- byline:ownership-guard
--
-- If this script was run by a superuser (e.g. `postgres`) rather than the
-- application's DB role, any object it created is owned by that superuser and
-- the app role gets "permission denied". Reassign every table and sequence in
-- `public` not already owned by the database owner — the app role, per
-- CREATE DATABASE ... WITH OWNER <app_role> — back to it. Indexes inherit
-- table ownership, so they follow automatically. No-op when the app role ran
-- the script (current_user = db owner) or nothing is mis-owned.
--
-- Keep this block identical across every sql/ migration: the ownership-guard
-- contract test asserts its presence in any script that creates a table. See
-- src/database/ownership-guard.test.node.ts.
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

COMMIT;
