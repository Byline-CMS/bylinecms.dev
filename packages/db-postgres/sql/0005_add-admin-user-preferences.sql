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
-- Ownership guard. If this script is run as a superuser (e.g. `postgres`), the
-- created table would be owned by that superuser and the application's DB role
-- would get "permission denied". Reassign it to the database owner — which is
-- the app role (CREATE DATABASE ... WITH OWNER <app_role>) — so the table is
-- accessible regardless of who runs the script. No-op when already correctly
-- owned.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'byline_admin_user_preferences'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "byline_admin_user_preferences" OWNER TO %I',
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
    );
  END IF;
END $$;

COMMIT;
