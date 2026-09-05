-- Document-wide optimistic concurrency: run with all writers and workers fenced.
-- This foundation is not independently releasable while old writers remain.
-- Native SQL and the incremental development migration share the same statements.
-- Do not squash the development chain until Task 10 review.
-- MySQL DDL commits implicitly. Resume by rerunning this entire script while fenced.
-- Every stage inspects actual schema/data, never a progress marker.
-- Failed assertions deliberately SELECT an unresolved diagnostic identifier: MySQL
-- SIGNAL is not preparable. This gives an actionable server error without creating
-- stored routines, requiring DEFINER permissions, or using client DELIMITER syntax.
-- The migration runner must stop on the first error (never mysql --force).
-- Stage 1: inspect existing columns before nullable additions.
SET @byline_revision_sql = IF(NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision' AND (DATA_TYPE <> 'bigint' OR COLUMN_TYPE LIKE '%unsigned%' OR EXTRA <> '')), 'DO 0', 'SELECT `Byline revision stage 1: repair incompatible revision BIGINT then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision'), 'ALTER TABLE `byline_documents` ADD COLUMN `revision` bigint NULL', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_document_publish_schedules' AND COLUMN_NAME = 'authorized_revision' AND (DATA_TYPE <> 'bigint' OR COLUMN_TYPE LIKE '%unsigned%' OR EXTRA <> '' OR IS_NULLABLE <> 'YES' OR COLUMN_DEFAULT IS NOT NULL)), 'DO 0', 'SELECT `Byline revision stage 1: repair incompatible authorized_revision BIGINT then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_document_publish_schedules' AND COLUMN_NAME = 'authorized_revision'), 'ALTER TABLE `byline_document_publish_schedules` ADD COLUMN `authorized_revision` bigint NULL', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
-- Stage 2: validate existing checks; widen the suspension reason before DML.
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_documents' AND t.CONSTRAINT_NAME = 'check_documents_revision' AND t.CONSTRAINT_TYPE = 'CHECK' AND (t.ENFORCED <> 'YES' OR LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) NOT IN (LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('revision BETWEEN 1 AND 9007199254740991', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))))), 'DO 0', 'SELECT `Byline revision stage 2: repair incompatible check_documents_revision then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_authorized_revision' AND t.CONSTRAINT_TYPE = 'CHECK' AND (t.ENFORCED <> 'YES' OR LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) NOT IN (LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('authorized_revision IS NULL OR authorized_revision BETWEEN 1 AND 9007199254740991', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))))), 'DO 0', 'SELECT `Byline revision stage 2: repair incompatible check_publish_schedules_authorized_revision then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK' AND (t.ENFORCED <> 'YES' OR LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) NOT IN (LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason = ''content_edited''', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')), LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'')', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))))), 'DO 0', 'SELECT `Byline revision stage 2: repair incompatible check_publish_schedules_suspended_reason then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK' AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) = LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason = ''content_edited''', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))), 'ALTER TABLE byline_document_publish_schedules DROP CHECK check_publish_schedules_suspended_reason', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK'), 'ALTER TABLE byline_document_publish_schedules ADD CONSTRAINT check_publish_schedules_suspended_reason CHECK (suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed''))', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
-- Stage 3: transactional data transition. A rerun never resets existing counters or authorization.
START TRANSACTION;
--> statement-breakpoint
UPDATE byline_documents SET revision = 1 WHERE revision IS NULL;
--> statement-breakpoint
UPDATE byline_document_publish_schedules
SET state = 'needs_reconfirm', suspended_at = CURRENT_TIMESTAMP(6),
    suspended_reason = 'document_metadata_changed', execution_token = NULL,
    execution_expires_at = NULL, updated_at = CURRENT_TIMESTAMP(6)
WHERE state = 'armed' AND authorized_revision IS NULL;
--> statement-breakpoint
COMMIT;
--> statement-breakpoint
-- Stage 4: verify data before tightening. Correct invalid data while fenced, then rerun.
SET @byline_revision_sql = IF(NOT EXISTS (SELECT 1 FROM byline_documents WHERE revision IS NULL OR revision NOT BETWEEN 1 AND 9007199254740991), 'DO 0', 'SELECT `Byline revision stage 4: repair invalid document revisions then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT 1 FROM byline_document_publish_schedules WHERE authorized_revision IS NOT NULL AND authorized_revision NOT BETWEEN 1 AND 9007199254740991), 'DO 0', 'SELECT `Byline revision stage 4: repair invalid schedule authorization then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
-- Stage 5: tighten nullable revision/remove defaults; add validated safe-range checks.
SET @byline_revision_sql = IF(EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision' AND (IS_NULLABLE = 'YES' OR COLUMN_DEFAULT IS NOT NULL)), 'ALTER TABLE byline_documents MODIFY COLUMN revision bigint NOT NULL', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_documents' AND t.CONSTRAINT_NAME = 'check_documents_revision' AND t.CONSTRAINT_TYPE = 'CHECK'), 'ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision CHECK (revision BETWEEN 1 AND 9007199254740991)', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_authorized_revision' AND t.CONSTRAINT_TYPE = 'CHECK'), 'ALTER TABLE byline_document_publish_schedules ADD CONSTRAINT check_publish_schedules_authorized_revision CHECK (authorized_revision IS NULL OR authorized_revision BETWEEN 1 AND 9007199254740991)', 'DO 0');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
-- Stage 6: final schema/data validation. Reopening writers is an operator action after full release validation.
SET @byline_revision_sql = IF(EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_documents' AND COLUMN_NAME = 'revision' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL AND EXTRA = ''), 'DO 0', 'SELECT `Byline revision stage 6: verify document column then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'byline_document_publish_schedules' AND COLUMN_NAME = 'authorized_revision' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL AND EXTRA = ''), 'DO 0', 'SELECT `Byline revision stage 6: verify schedule column then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_documents' AND t.CONSTRAINT_NAME = 'check_documents_revision' AND t.CONSTRAINT_TYPE = 'CHECK' AND t.ENFORCED = 'YES' AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) = LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('revision BETWEEN 1 AND 9007199254740991', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))), 'DO 0', 'SELECT `Byline revision stage 6: verify check_documents_revision then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_authorized_revision' AND t.CONSTRAINT_TYPE = 'CHECK' AND t.ENFORCED = 'YES' AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) = LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('authorized_revision IS NULL OR authorized_revision BETWEEN 1 AND 9007199254740991', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))), 'DO 0', 'SELECT `Byline revision stage 6: verify check_publish_schedules_authorized_revision then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(EXISTS (SELECT c.CHECK_CLAUSE, t.ENFORCED FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'byline_document_publish_schedules' AND t.CONSTRAINT_NAME = 'check_publish_schedules_suspended_reason' AND t.CONSTRAINT_TYPE = 'CHECK' AND t.ENFORCED = 'YES' AND LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(c.CHECK_CLAUSE, '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', '')) = LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE('suspended_reason IS NULL OR suspended_reason IN (''content_edited'', ''document_metadata_changed'')', '_utf8mb4', ''), '_utf8mb3', ''), CHAR(92), ''), '[[:space:]`()]+', ''))), 'DO 0', 'SELECT `Byline revision stage 6: verify check_publish_schedules_suspended_reason then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
--> statement-breakpoint
SET @byline_revision_sql = IF(NOT EXISTS (SELECT 1 FROM byline_document_publish_schedules WHERE state = 'armed' AND authorized_revision IS NULL), 'DO 0', 'SELECT `Byline revision stage 6: stop legacy schedule writers then rerun`');
--> statement-breakpoint
PREPARE byline_revision_statement FROM @byline_revision_sql;
--> statement-breakpoint
EXECUTE byline_revision_statement;
--> statement-breakpoint
DEALLOCATE PREPARE byline_revision_statement;
