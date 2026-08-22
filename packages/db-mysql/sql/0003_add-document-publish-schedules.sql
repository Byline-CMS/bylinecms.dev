-- =============================================================================
-- Byline: scheduled publication state  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Adds `byline_document_publish_schedules` — one document-grain publication
-- intent row with pinned-version, suspension, retry, and execution-fence state.
-- Drizzle-independent equivalent of the final schema in
-- packages/db-mysql/src/database/schema/index.ts, for an existing production
-- database that does not run `drizzle:migrate`.
--
--   mysql -u byline -p byline_dev < packages/db-mysql/sql/0003_add-document-publish-schedules.sql
--
-- Idempotent: guarded on the table's absence. MySQL DDL auto-commits, so a
-- surrounding transaction could not make this CREATE TABLE transactional.
-- =============================================================================

-- Check-constraint string literals inherit the client connection charset.
-- Pin it so running this file through a stock mysql client produces the same
-- `_utf8mb4` constraints as Drizzle over the application's mysql2 pool.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `byline_document_publish_schedules` (
  `document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publish_at` datetime(6) NOT NULL,
  `state` varchar(32) NOT NULL DEFAULT 'armed',
  `suspended_at` datetime(6),
  `suspended_reason` varchar(32),
  `scheduled_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
  `last_authorized_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
  `last_authorized_at` datetime(6) NOT NULL,
  `scheduled_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `execution_token` char(36) CHARACTER SET ascii COLLATE ascii_bin,
  `execution_expires_at` datetime(6),
  `last_attempt_at` datetime(6),
  `next_attempt_at` datetime(6) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `last_error` text,
  CONSTRAINT `byline_document_publish_schedules_document_id` PRIMARY KEY (`document_id`),
  CONSTRAINT `check_publish_schedules_state`
    CHECK (`state` IN ('armed', 'needs_reconfirm')),
  CONSTRAINT `check_publish_schedules_suspended_reason`
    CHECK (`suspended_reason` IS NULL OR `suspended_reason` = 'content_edited'),
  CONSTRAINT `fk_publish_schedules_document`
    FOREIGN KEY (`document_id`) REFERENCES `byline_documents` (`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_publish_schedules_collection`
    FOREIGN KEY (`collection_id`) REFERENCES `byline_collections` (`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_publish_schedules_target_version`
    FOREIGN KEY (`target_version_id`) REFERENCES `byline_document_versions` (`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  INDEX `idx_document_publish_schedules_due` (`state`, `next_attempt_at`, `publish_at`),
  INDEX `idx_document_publish_schedules_execution_expiry` (`execution_expires_at`)
);
