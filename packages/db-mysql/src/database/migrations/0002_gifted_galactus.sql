-- R1-1: idempotent constraint widening; rerun from the beginning if interrupted.
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK' AND (t.ENFORCED <> 'YES' OR LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) NOT IN (LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason = ''content_edited''', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')), LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'')', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')), LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'', ''upgrade_invalidated'')', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))))), 'DO 0', 'SELECT `Byline revision stage 2: repair incompatible check_publish_schedules_suspended_reason then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK' AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) IN (LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason = ''content_edited''', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')), LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'')', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')))), 'ALTER TABLE byline_document_publish_schedules DROP CHECK check_publish_schedules_suspended_reason', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK'), 'ALTER TABLE byline_document_publish_schedules ADD CONSTRAINT check_publish_schedules_suspended_reason CHECK (suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'', ''upgrade_invalidated''))', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
-- Re-label legacy schedules already suspended by the earlier development upgrade.
UPDATE byline_document_publish_schedules SET suspended_reason = 'upgrade_invalidated'
WHERE authorized_revision IS NULL AND state = 'needs_reconfirm'
  AND suspended_reason = 'document_metadata_changed';
