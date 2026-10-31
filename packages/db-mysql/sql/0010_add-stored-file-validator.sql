-- Byline: stored-file content identity — storage validator columns.
-- `file_hash` already exists; this adds the validator of the stored version the
-- hash was computed from. Both columns are written and read as a pair and are
-- NULL when unknown. Existing rows stay NULL until backfilled
-- (byline/scripts/backfill-file-identity.ts).
-- MySQL DDL auto-commits; each column is added only when missing, so the script
-- is safe to rerun if interrupted between the two columns.
SET @byline_file_validator_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'byline_store_file' AND column_name = 'storage_validator_kind'),
  'SELECT 1',
  'ALTER TABLE byline_store_file ADD COLUMN storage_validator_kind varchar(32) NULL'
);
PREPARE byline_file_validator_statement FROM @byline_file_validator_ddl;
EXECUTE byline_file_validator_statement;
DEALLOCATE PREPARE byline_file_validator_statement;

SET @byline_file_validator_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'byline_store_file' AND column_name = 'storage_validator_value'),
  'SELECT 1',
  'ALTER TABLE byline_store_file ADD COLUMN storage_validator_value varchar(1024) NULL'
);
PREPARE byline_file_validator_statement FROM @byline_file_validator_ddl;
EXECUTE byline_file_validator_statement;
DEALLOCATE PREPARE byline_file_validator_statement;
