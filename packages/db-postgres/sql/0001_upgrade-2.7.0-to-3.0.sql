-- =============================================================================
-- Byline upgrade: 2.7.0 (or 2.6.x) -> 3.0  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- A single, idempotent, Drizzle-independent schema migration for an existing
-- production database. Equivalent to applying Drizzle migrations 0001-0004 (the
-- only schema delta from the 2.7.0/2.6.x baseline, which both current production
-- sites share — see docs/MIGRATION-TO-3.0.md). Use this instead of
-- `drizzle:migrate`: after a release squash the Drizzle journal no longer
-- matches a deployed DB, and the deployed DBs may not carry the Drizzle schema
-- at all.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0001_upgrade-2.7.0-to-3.0.sql
--
-- Idempotent and safe to re-run: every object uses IF [NOT] EXISTS, and the
-- whole thing runs in one transaction (Postgres DDL is transactional), so a
-- failure rolls back cleanly.
--
-- This script is DDL ONLY. The two data backfills are separate steps (run them
-- AFTER this script) — see docs/MIGRATION-TO-3.0.md "Part A2":
--   1. source_locale  — AUTOMATIC: `initBylineCore()` stamps NULL rows with the
--      configured default content locale on first boot of the 3.0 server. No
--      manual step. (Kept out of this script so the configured default never has
--      to be hard-coded here.)
--   2. version-locale ledger — run once after deploy:
--        cd apps/webapp && pnpm tsx byline/scripts/backfill-version-locales.ts
--      (kept out of this script to avoid a second, drift-prone copy of the
--      `backfillVersionLocales` SQL — the adapter method is the source of truth).
--
-- CAUTION: do NOT run `drizzle:migrate` against a DB upgraded with this script —
-- the journal points at superseded (squashed) migration hashes. Existing-site
-- upgrades use this script; `drizzle:migrate` is for fresh installs only.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0001 — version-locale completeness ledger
-- One row per (version, locale) the version's content is *complete* in
-- (path-coverage against the document's source locale). Drives `onMissingLocale`
-- 'omit'/strict reads and the `_availableVersionLocales` read metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "byline_document_version_locales" (
  "document_version_id" uuid NOT NULL,
  "locale" varchar(10) NOT NULL,
  CONSTRAINT "byline_document_version_locales_document_version_id_locale_pk"
    PRIMARY KEY ("document_version_id", "locale"),
  CONSTRAINT "byline_document_version_locales_document_version_id_byline_document_versions_id_fk"
    FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

-- ---------------------------------------------------------------------------
-- 0002 — editorial advertised-locale set (document-grain)
-- The locales an editor has elected to advertise for a document (`advertiseLocales`
-- collections). Surfaced on reads as `availableLocales`; the public advertised set
-- is `availableLocales ∩ _availableVersionLocales`. Starts empty — see the
-- editorial-data-migration note (Part C) in docs/MIGRATION-TO-3.0.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "byline_document_available_locales" (
  "document_id" uuid NOT NULL,
  "locale" varchar(10) NOT NULL,
  "collection_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "byline_document_available_locales_document_id_locale_pk"
    PRIMARY KEY ("document_id", "locale"),
  CONSTRAINT "byline_document_available_locales_document_id_byline_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."byline_documents"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "byline_document_available_locales_collection_id_byline_collections_id_fk"
    FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_document_available_locales_document_id"
  ON "byline_document_available_locales" USING btree ("document_id");

-- ---------------------------------------------------------------------------
-- 0003 — per-document content-locale anchor (nullable)
-- The locale a document was authored in: its fallback floor, path locale, and
-- completeness yardstick. Stays nullable; the read/write paths COALESCE NULL to
-- the configured default, and `initBylineCore()` stamps NULL rows at boot. See
-- docs/DEFAULT-LOCALE-SWITCHING.md.
-- ---------------------------------------------------------------------------
ALTER TABLE "byline_documents" ADD COLUMN IF NOT EXISTS "source_locale" varchar(10);

-- ---------------------------------------------------------------------------
-- 0004 — re-project the current-documents views to carry source_locale
-- View-definition change only (no data movement). DROP+CREATE (faithful to the
-- tested 0004 migration; these views have no dependents). The added columns
-- (order_key already present in 2.7.0; source_locale new) come from the existing
-- PK join to byline_documents.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS "public"."byline_current_documents";
DROP VIEW IF EXISTS "public"."byline_current_published_documents";

CREATE VIEW "public"."byline_current_documents" AS (
  with "sq" as (
    select "id", "document_id", "collection_id", "collection_version", "event_type",
           "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary",
           row_number() OVER (PARTITION BY "document_id" ORDER BY "id" DESC) as "rn"
    from "byline_document_versions"
    where "byline_document_versions"."is_deleted" = false
  )
  select "sq"."id", "sq"."document_id", "sq"."collection_id", "sq"."collection_version",
         "sq"."event_type", "sq"."status", "sq"."is_deleted", "sq"."created_at",
         "sq"."updated_at", "sq"."created_by", "sq"."change_summary",
         "byline_documents"."order_key", "byline_documents"."source_locale"
  from "sq"
  inner join "byline_documents" on "byline_documents"."id" = "sq"."document_id"
  where "rn" = 1
);

CREATE VIEW "public"."byline_current_published_documents" AS (
  with "sq" as (
    select "id", "document_id", "collection_id", "collection_version", "event_type",
           "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary",
           row_number() OVER (PARTITION BY "document_id" ORDER BY "id" DESC) as "rn"
    from "byline_document_versions"
    where "byline_document_versions"."is_deleted" = false
      AND "byline_document_versions"."status" = 'published'
  )
  select "sq"."id", "sq"."document_id", "sq"."collection_id", "sq"."collection_version",
         "sq"."event_type", "sq"."status", "sq"."is_deleted", "sq"."created_at",
         "sq"."updated_at", "sq"."created_by", "sq"."change_summary",
         "byline_documents"."order_key", "byline_documents"."source_locale"
  from "sq"
  inner join "byline_documents" on "byline_documents"."id" = "sq"."document_id"
  where "rn" = 1
);

COMMIT;

-- =============================================================================
-- After this script: deploy 3.0 (boot stamps source_locale), then run the
-- version-locale ledger backfill, then verify — see docs/MIGRATION-TO-3.0.md.
-- =============================================================================
