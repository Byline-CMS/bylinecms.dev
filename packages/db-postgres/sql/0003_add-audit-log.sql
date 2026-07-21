-- =============================================================================
-- Byline: document-grain audit log  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds the `byline_audit_log` table + its three indexes. Drizzle-independent
-- equivalent of migration `0001_silly_mojo.sql` (the only schema delta on top of
-- the post-squash 3.0 baseline), for an existing production database that does
-- not run `drizzle:migrate`. Backs the auditability work — see docs/AUDIT.md
-- (Workstreams 2-3): the document-grain audit log (non-versioned path /
-- available-locales writes, in-place status transitions, deletions) and the
-- document-history view.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0003_add-audit-log.sql
--
-- Safe to run as either the application's DB role OR a superuser: the final
-- step reassigns the new table to the database owner (the app role), so the
-- running server can always read/write it. (Without that, a table created by a
-- superuser like `postgres` is invisible to the app role — `permission denied`.)
--
-- Idempotent and safe to re-run: every object uses IF NOT EXISTS, the ownership
-- reassignment is a no-op when already correct, and the whole thing runs in one
-- transaction (Postgres DDL is transactional), so a failure rolls back cleanly.
--
-- Purely additive: a new table, no backfill, no NOT NULL retrofit, no view
-- changes — so the existing-site upgrade is just "run this script, then deploy".
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- byline_audit_log — one immutable row per audited document-grain change.
-- Deliberately FK-FREE: an audit row must outlive the document / collection /
-- actor it names (a `document.deleted` row cannot cascade-delete itself).
-- `id` is a UUIDv7 (time-ordered — no separate sort column needed); nullable
-- `document_id` + a namespaced `action` leave room for future admin-realm
-- events (Workstream 4) in the same table without a second migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "byline_audit_log" (
  "id" uuid PRIMARY KEY NOT NULL,
  "document_id" uuid,
  "collection_id" uuid,
  "actor_id" uuid,
  "actor_realm" varchar(16) NOT NULL,
  "action" varchar(64) NOT NULL,
  "field" varchar(128),
  "before" jsonb,
  "after" jsonb,
  "occurred_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);

-- Composite indexes lead with the filter column and trail with `id` so the
-- UUIDv7 ordering gives newest-first paging for free on each access pattern:
-- per-document history, per-actor activity, and per-action filtering.
CREATE INDEX IF NOT EXISTS "idx_audit_log_document_id"
  ON "byline_audit_log" USING btree ("document_id", "id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_actor_id"
  ON "byline_audit_log" USING btree ("actor_id", "id");
CREATE INDEX IF NOT EXISTS "idx_audit_log_action"
  ON "byline_audit_log" USING btree ("action", "id");

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
