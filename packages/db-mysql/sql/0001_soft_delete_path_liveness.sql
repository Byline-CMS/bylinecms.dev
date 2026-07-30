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
--   - malformed/versionless legacy rows fall back to the path timestamps and
--     finally the migration timestamp.
--
--   mysql -u byline -p byline_dev < packages/db-mysql/sql/0001_soft_delete_path_liveness.sql
--
-- MySQL DDL auto-commits. Each DDL step is guarded through information_schema,
-- and the old/new unique-key swap is one atomic ALTER TABLE. If execution is
-- interrupted, inspect the final diagnostics below and rerun the whole script;
-- it converges any supported partial state to the completed schema and backfill.
-- =============================================================================

SET @byline_schema := DATABASE();

SET @byline_has_deleted_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @byline_schema
    AND TABLE_NAME = 'byline_document_paths'
    AND COLUMN_NAME = 'deleted_at'
);
SET @byline_sql := IF(
  @byline_has_deleted_at = 0,
  'ALTER TABLE `byline_document_paths` ADD COLUMN `deleted_at` datetime(6) NULL',
  'DO 0'
);
PREPARE byline_statement FROM @byline_sql;
EXECUTE byline_statement;
DEALLOCATE PREPARE byline_statement;

SET @byline_has_alive := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @byline_schema
    AND TABLE_NAME = 'byline_document_paths'
    AND COLUMN_NAME = 'alive'
);
SET @byline_sql := IF(
  @byline_has_alive = 0,
  'ALTER TABLE `byline_document_paths` ADD COLUMN `alive` boolean GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN true ELSE NULL END) STORED',
  'DO 0'
);
PREPARE byline_statement FROM @byline_sql;
EXECUTE byline_statement;
DEALLOCATE PREPARE byline_statement;

START TRANSACTION;

UPDATE `byline_document_paths` AS `path`
LEFT JOIN (
  SELECT
    `document_id`,
    MAX(`updated_at`) AS `latest_updated_at`,
    MAX(CASE WHEN `is_deleted` = false THEN 1 ELSE 0 END) AS `has_live_version`
  FROM `byline_document_versions`
  GROUP BY `document_id`
) AS `version_state` ON `version_state`.`document_id` = `path`.`document_id`
SET `path`.`deleted_at` = COALESCE(
  `version_state`.`latest_updated_at`,
  `path`.`updated_at`,
  `path`.`created_at`,
  CURRENT_TIMESTAMP(6)
)
WHERE `path`.`deleted_at` IS NULL
  AND COALESCE(`version_state`.`has_live_version`, 0) = 0;

COMMIT;

SET @byline_path_index_columns := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @byline_schema
    AND TABLE_NAME = 'byline_document_paths'
    AND INDEX_NAME = 'idx_document_paths_collection_locale_path'
);
SET @byline_sql := CASE
  WHEN @byline_path_index_columns = 'collection_id,locale,path,alive' THEN
    'DO 0'
  WHEN @byline_path_index_columns IS NULL THEN
    'ALTER TABLE `byline_document_paths` ADD UNIQUE INDEX `idx_document_paths_collection_locale_path` (`collection_id`, `locale`, `path`, `alive`)'
  ELSE
    'ALTER TABLE `byline_document_paths` DROP INDEX `idx_document_paths_collection_locale_path`, ADD UNIQUE INDEX `idx_document_paths_collection_locale_path` (`collection_id`, `locale`, `path`, `alive`)'
END;
PREPARE byline_statement FROM @byline_sql;
EXECUTE byline_statement;
DEALLOCATE PREPARE byline_statement;

-- Operator diagnostics: a completed run returns STORED GENERATED, the exact
-- four-column key, and zero fully deleted paths still marked live.
SELECT COLUMN_TYPE, IS_NULLABLE, EXTRA, GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @byline_schema
  AND TABLE_NAME = 'byline_document_paths'
  AND COLUMN_NAME IN ('deleted_at', 'alive')
ORDER BY ORDINAL_POSITION;

SELECT
  INDEX_NAME,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS index_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = @byline_schema
  AND TABLE_NAME = 'byline_document_paths'
  AND INDEX_NAME IN (
    'unique_document_paths_document_locale',
    'idx_document_paths_collection_locale_path'
  )
GROUP BY INDEX_NAME
ORDER BY INDEX_NAME;

SELECT COUNT(*) AS fully_deleted_paths_still_live
FROM `byline_document_paths` AS `path`
WHERE `path`.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `byline_document_versions` AS `live_version`
    WHERE `live_version`.`document_id` = `path`.`document_id`
      AND `live_version`.`is_deleted` = false
  );
