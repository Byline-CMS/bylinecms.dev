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

COMMIT;
