-- =============================================================================
-- Byline: soft-delete path liveness
-- =============================================================================
--
-- Retains historical document paths while releasing their live namespace
-- ownership. `alive` is generated from `deleted_at`, so the two values cannot
-- drift independently.
--
-- Backfill policy:
--   - any non-deleted version keeps every path for its document live;
--   - otherwise the latest version `updated_at` is the best available deletion
--     timestamp;
--   - malformed legacy rows with versions fall back to the path timestamps and
--     finally the migration timestamp;
--   - versionless bootstrap documents remain live because no deletion occurred.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0006_soft_delete_path_liveness.sql
--
-- Idempotent and transactional. Re-running the script converges the columns,
-- backfill, and unique constraint to the same completed state.
-- =============================================================================

BEGIN;

ALTER TABLE "byline_document_paths"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp (6) with time zone;

ALTER TABLE "byline_document_paths"
  ADD COLUMN IF NOT EXISTS "alive" boolean
  GENERATED ALWAYS AS (
    CASE WHEN "deleted_at" IS NULL THEN true ELSE NULL END
  ) STORED;

UPDATE "byline_document_paths" AS "path"
SET "deleted_at" = COALESCE(
  (
    SELECT MAX("version"."updated_at")
    FROM "byline_document_versions" AS "version"
    WHERE "version"."document_id" = "path"."document_id"
  ),
  "path"."updated_at",
  "path"."created_at",
  CURRENT_TIMESTAMP
)
WHERE "path"."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "byline_document_versions" AS "version"
    WHERE "version"."document_id" = "path"."document_id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "byline_document_versions" AS "live_version"
    WHERE "live_version"."document_id" = "path"."document_id"
      AND "live_version"."is_deleted" = false
  );

DO $$
DECLARE
  path_key_columns text[];
BEGIN
  SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO path_key_columns
  FROM pg_constraint AS constraint_definition
  CROSS JOIN LATERAL unnest(constraint_definition.conkey)
    WITH ORDINALITY AS key_column(attribute_number, ordinality)
  JOIN pg_attribute AS attribute
    ON attribute.attrelid = constraint_definition.conrelid
    AND attribute.attnum = key_column.attribute_number
  WHERE constraint_definition.conrelid = 'byline_document_paths'::regclass
    AND constraint_definition.conname = 'idx_document_paths_collection_locale_path';

  IF path_key_columns IS DISTINCT FROM ARRAY['collection_id', 'locale', 'path', 'alive'] THEN
    ALTER TABLE "byline_document_paths"
      DROP CONSTRAINT IF EXISTS "idx_document_paths_collection_locale_path";
    ALTER TABLE "byline_document_paths"
      ADD CONSTRAINT "idx_document_paths_collection_locale_path"
      UNIQUE ("collection_id", "locale", "path", "alive");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'byline_document_paths'::regclass
      AND attname = 'alive'
      AND attgenerated = 's'
  ) THEN
    RAISE EXCEPTION 'byline_document_paths.alive must be a stored generated column';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "byline_document_paths" AS "path"
    WHERE "path"."deleted_at" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "byline_document_versions" AS "version"
        WHERE "version"."document_id" = "path"."document_id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "byline_document_versions" AS "live_version"
        WHERE "live_version"."document_id" = "path"."document_id"
          AND "live_version"."is_deleted" = false
      )
  ) THEN
    RAISE EXCEPTION 'fully deleted document paths remain live after backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "byline_document_paths" AS "path"
    WHERE "path"."deleted_at" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "byline_document_versions" AS "live_version"
        WHERE "live_version"."document_id" = "path"."document_id"
          AND "live_version"."is_deleted" = false
      )
  ) THEN
    RAISE EXCEPTION 'live document versions retain deleted paths after backfill';
  END IF;
END $$;

COMMIT;
