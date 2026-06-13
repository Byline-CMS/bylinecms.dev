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
-- Run as the application's DB role (the role in $DATABASE_URL / the database
-- owner), NOT as a superuser — so the table is owned by the app role and the
-- running server can read/write it. A table created by `postgres` is invisible
-- to the app role (permission denied) until ownership is reassigned.
--
-- Idempotent and safe to re-run: every object uses IF NOT EXISTS, and the whole
-- thing runs in one transaction (Postgres DDL is transactional), so a failure
-- rolls back cleanly.
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

COMMIT;
