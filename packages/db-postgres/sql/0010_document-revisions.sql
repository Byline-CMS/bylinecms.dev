-- Document-wide optimistic concurrency: run with all writers and workers fenced.
-- This foundation is not independently releasable while old writers remain.
-- Native SQL is equivalent to the incremental development migration chain.
-- Do not squash the development chain until Task 10 review.
BEGIN;
DO $$
BEGIN
  -- Stage 1: refuse incompatible partial columns before changing any data.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND ((table_name = 'byline_documents' AND column_name = 'revision')
        OR (table_name = 'byline_document_publish_schedules' AND column_name = 'authorized_revision'))
      AND (data_type <> 'bigint' OR is_generated <> 'NEVER'
        OR (column_name = 'authorized_revision' AND (is_nullable <> 'YES' OR column_default IS NOT NULL)))
  ) THEN
    RAISE EXCEPTION 'Byline revision stage 1: incompatible column; restore signed BIGINT definitions and rerun while fenced';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE byline_documents ADD COLUMN IF NOT EXISTS revision bigint;
--> statement-breakpoint
ALTER TABLE byline_document_publish_schedules ADD COLUMN IF NOT EXISTS authorized_revision bigint;
--> statement-breakpoint
ALTER TABLE byline_document_publish_schedules DROP CONSTRAINT IF EXISTS check_document_publish_schedules_suspended_reason;
--> statement-breakpoint
ALTER TABLE byline_document_publish_schedules ADD CONSTRAINT check_document_publish_schedules_suspended_reason
  CHECK (suspended_reason IS NULL OR suspended_reason IN ('content_edited', 'document_metadata_changed', 'upgrade_invalidated'));
--> statement-breakpoint
-- Stage 2: legacy authorization cannot be reconstructed from revision 1.
UPDATE byline_documents SET revision = 1 WHERE revision IS NULL;
--> statement-breakpoint
UPDATE byline_document_publish_schedules
SET state = 'needs_reconfirm', suspended_at = CURRENT_TIMESTAMP(6),
    suspended_reason = 'upgrade_invalidated', execution_token = NULL,
    execution_expires_at = NULL, updated_at = CURRENT_TIMESTAMP(6)
WHERE state = 'armed' AND authorized_revision IS NULL;
--> statement-breakpoint
-- Re-label legacy schedules already suspended by the earlier development upgrade.
UPDATE byline_document_publish_schedules SET suspended_reason = 'upgrade_invalidated'
WHERE authorized_revision IS NULL AND state = 'needs_reconfirm'
  AND suspended_reason = 'document_metadata_changed';
--> statement-breakpoint
-- Stage 3: constraints validate existing data; any failure rolls back the native transaction.
ALTER TABLE byline_documents ALTER COLUMN revision SET NOT NULL;
--> statement-breakpoint
ALTER TABLE byline_documents ALTER COLUMN revision DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE byline_documents DROP CONSTRAINT IF EXISTS check_documents_revision;
--> statement-breakpoint
ALTER TABLE byline_documents ADD CONSTRAINT check_documents_revision
  CHECK (revision BETWEEN 1 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE byline_document_publish_schedules DROP CONSTRAINT IF EXISTS check_publish_schedules_authorized_revision;
--> statement-breakpoint
ALTER TABLE byline_document_publish_schedules ADD CONSTRAINT check_publish_schedules_authorized_revision
  CHECK (authorized_revision IS NULL OR authorized_revision BETWEEN 1 AND 9007199254740991);
COMMIT;
