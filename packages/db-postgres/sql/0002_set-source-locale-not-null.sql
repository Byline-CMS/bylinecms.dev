-- =============================================================================
-- Byline 3.0 hardening: byline_documents.source_locale -> NOT NULL
-- =============================================================================
--
-- Sibling to `0001_upgrade-2.7.0-to-3.0.sql`. Run this **after** the 3.0 upgrade is
-- complete and every document has a stamped `source_locale` — i.e. after the
-- 3.0 server has booted at least once (`initBylineCore()` runs
-- `backfillSourceLocales()` on startup) or you have run the backfill explicitly.
-- Deferred from the main upgrade on purpose: the column ships nullable and the
-- read/write paths COALESCE NULL -> the configured default, so the upgrade never
-- has to hard-code the default locale and `drizzle:migrate` never fails on the
-- constraint. This script applies the invariant once installs have bedded in.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0002_set-source-locale-not-null.sql
--
-- Idempotent and safe to re-run: the guard re-checks, and `SET NOT NULL` is a
-- no-op when the constraint already exists. Runs in one transaction, so a failed
-- guard changes nothing.
--
-- NOTE: this is an out-of-band constraint that is NOT (yet) reflected in the
-- Drizzle schema (`schema/index.ts` keeps `source_locale` nullable with COALESCE
-- fallbacks). Until a future release folds NOT NULL into the schema + baseline,
-- a `drizzle:generate` will want to re-add a "drop not null" — expected; ignore.
-- =============================================================================

BEGIN;

-- Guard: refuse (with a clear, actionable message) if any document is still
-- unstamped. The bare `SET NOT NULL` would otherwise fail with a generic
-- "column contains null values" error.
DO $$
DECLARE
  null_count bigint;
BEGIN
  SELECT count(*) INTO null_count
  FROM byline_documents
  WHERE source_locale IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Cannot set byline_documents.source_locale NOT NULL: % row(s) are still NULL. Boot the 3.0 server (initBylineCore runs backfillSourceLocales) or run the backfill explicitly first.',
      null_count;
  END IF;
END $$;

ALTER TABLE "byline_documents" ALTER COLUMN "source_locale" SET NOT NULL;

COMMIT;
