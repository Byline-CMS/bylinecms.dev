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
-- Ownership guard. If this script is run as a superuser (e.g. `postgres`), the
-- new table would be owned by that superuser and the application's DB role would
-- get "permission denied". Reassign it to the database owner — which is the app
-- role (CREATE DATABASE ... WITH OWNER <app_role>) — so the table is accessible
-- regardless of who runs the script. Indexes inherit table ownership, so they
-- follow automatically. No-op when the table is already correctly owned.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format(
    'ALTER TABLE "byline_audit_log" OWNER TO %I',
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
  );
END $$;

COMMIT;
