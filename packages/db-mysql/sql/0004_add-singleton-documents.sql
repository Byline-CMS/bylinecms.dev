-- =============================================================================
-- Byline: singleton document mapping  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds the singleton slot -> document mapping that enforces zero-or-one
-- cardinality, plus the supporting composite unique key required by MySQL for
-- the mapping's collection-ownership foreign key.
--
-- MySQL DDL auto-commits. Every step is independently guarded so the script is
-- safe to run again after success or a partial failure.
-- =============================================================================

SET @byline_have_documents_ownership_key := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'byline_documents'
    AND CONSTRAINT_NAME = 'uq_documents_collection_id_id'
    AND CONSTRAINT_TYPE = 'UNIQUE'
);

SET @byline_sql := IF(
  @byline_have_documents_ownership_key = 0,
  'ALTER TABLE `byline_documents` ADD CONSTRAINT `uq_documents_collection_id_id` UNIQUE (`collection_id`, `id`)',
  'SELECT 1'
);
PREPARE byline_statement FROM @byline_sql;
EXECUTE byline_statement;
DEALLOCATE PREPARE byline_statement;

CREATE TABLE IF NOT EXISTS `byline_singleton_documents` (
  `collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  CONSTRAINT `byline_singleton_documents_collection_id` PRIMARY KEY (`collection_id`),
  CONSTRAINT `byline_singleton_documents_document_id_unique` UNIQUE (`document_id`),
  CONSTRAINT `fk_singleton_documents_document`
    FOREIGN KEY (`collection_id`, `document_id`)
    REFERENCES `byline_documents` (`collection_id`, `id`)
    ON DELETE CASCADE ON UPDATE NO ACTION
);
