-- =============================================================================
-- Byline: recurring-task scheduler state  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds `byline_recurring_tasks` — durable claim, lease, retry, and health
-- state for Byline's first-class recurring-task scheduler.
-- Drizzle-independent equivalent of the final schema in
-- packages/db-postgres/src/database/schema/index.ts, for an existing
-- production database that does not run `drizzle:migrate`.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0007_add-recurring-tasks.sql
--
-- Idempotent: guarded on the table's absence. Runs in one transaction.
--
-- Safe to run as either the application's DB role OR a superuser: the final step
-- reassigns the table to the database owner (the app role), so the running
-- server can always read/write it.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "byline_recurring_tasks" (
  "name" varchar(255) PRIMARY KEY NOT NULL,
  "interval_ms" bigint NOT NULL,
  "next_run_at" timestamp with time zone NOT NULL,
  "lease_token" uuid,
  "lease_owner" varchar(255),
  "lease_expires_at" timestamp with time zone,
  "last_started_at" timestamp with time zone,
  "last_succeeded_at" timestamp with time zone,
  "last_failed_at" timestamp with time zone,
  "last_duration_ms" bigint,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "last_status" varchar(32) DEFAULT 'never_run' NOT NULL,
  "last_error" text,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);

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
