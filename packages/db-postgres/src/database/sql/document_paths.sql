-- Phase 1 backfill: byline_document_paths.
--
-- Run AFTER Drizzle migration 0002 (which creates byline_document_paths)
-- and BEFORE Drizzle migration 0003 (which drops byline_document_versions.path
-- and recreates the current_* views without the path column).
--
-- Populates one row per logical document, sourced from the latest
-- non-deleted version via byline_current_documents. Tags every row with
-- the installation's default content locale.
--
-- locale must be supplied as a psql variable. Example:
--
--   psql -v default_locale=en \
--     -f packages/db-postgres/src/database/sql/document_paths.sql
--
-- The value should match ServerConfig.i18n.content.defaultLocale for the
-- installation. The default-locale-required invariant guarantees every
-- existing logical document was created in this locale, so tagging the
-- backfilled rows accordingly is correct by construction.
--
-- Wrapped in a transaction so a unique-constraint failure (collisions in
-- local data on (collection_id, locale, path)) leaves the table empty
-- and rolls back cleanly.

\if :{?default_locale}
\else
  \echo 'ERROR: default_locale is required. Run with: psql -v default_locale=en -f ...'
  \quit
\endif

BEGIN;

INSERT INTO "byline_document_paths" ("document_id", "collection_id", "locale", "path")
SELECT "document_id", "collection_id", :'default_locale', "path"
FROM "byline_current_documents";

COMMIT;
