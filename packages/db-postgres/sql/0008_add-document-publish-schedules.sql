-- =============================================================================
-- Byline: scheduled publication state  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds `byline_document_publish_schedules` — one document-grain publication
-- intent row with pinned-version, suspension, retry, and execution-fence state.
-- Drizzle-independent equivalent of the final schema in
-- packages/db-postgres/src/database/schema/index.ts, for an existing
-- production database that does not run `drizzle:migrate`.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0008_add-document-publish-schedules.sql
--
-- Idempotent: guarded on the table and indexes. Runs in one transaction.
--
-- Safe to run as either the application's DB role OR a superuser: the final step
-- reassigns the table to the database owner (the app role), so the running
-- server can always read/write it.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "byline_document_publish_schedules" (
  "document_id" uuid PRIMARY KEY NOT NULL,
  "collection_id" uuid NOT NULL,
  "target_version_id" uuid NOT NULL,
  "publish_at" timestamp (6) with time zone NOT NULL,
  "state" varchar(32) DEFAULT 'armed' NOT NULL,
  "suspended_at" timestamp (6) with time zone,
  "suspended_reason" varchar(32),
  "scheduled_by" uuid,
  "last_authorized_by" uuid,
  "last_authorized_at" timestamp (6) with time zone NOT NULL,
  "scheduled_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "execution_token" uuid,
  "execution_expires_at" timestamp (6) with time zone,
  "last_attempt_at" timestamp (6) with time zone,
  "next_attempt_at" timestamp (6) with time zone NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  CONSTRAINT "check_document_publish_schedules_state"
    CHECK ("state" IN ('armed', 'needs_reconfirm')),
  CONSTRAINT "check_document_publish_schedules_suspended_reason"
    CHECK ("suspended_reason" IS NULL OR "suspended_reason" = 'content_edited'),
  CONSTRAINT "byline_document_publish_schedules_document_id_byline_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "byline_documents"("id") ON DELETE CASCADE,
  CONSTRAINT "byline_document_publish_schedules_collection_id_byline_collections_id_fk"
    FOREIGN KEY ("collection_id") REFERENCES "byline_collections"("id") ON DELETE CASCADE,
  CONSTRAINT "byline_document_publish_schedules_target_version_id_byline_document_versions_id_fk"
    FOREIGN KEY ("target_version_id") REFERENCES "byline_document_versions"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_document_publish_schedules_due"
  ON "byline_document_publish_schedules" ("next_attempt_at", "publish_at")
  WHERE "state" = 'armed';

CREATE INDEX IF NOT EXISTS "idx_document_publish_schedules_execution_expiry"
  ON "byline_document_publish_schedules" ("execution_expires_at");

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
