ALTER TABLE "byline_document_publish_schedules" DROP CONSTRAINT IF EXISTS "check_document_publish_schedules_suspended_reason";--> statement-breakpoint
ALTER TABLE "byline_document_publish_schedules" ADD CONSTRAINT "check_document_publish_schedules_suspended_reason" CHECK ("byline_document_publish_schedules"."suspended_reason" IS NULL OR "byline_document_publish_schedules"."suspended_reason" IN ('content_edited', 'document_metadata_changed', 'upgrade_invalidated'));
--> statement-breakpoint
-- Re-label legacy schedules already suspended by the earlier development upgrade.
UPDATE byline_document_publish_schedules SET suspended_reason = 'upgrade_invalidated'
WHERE authorized_revision IS NULL AND state = 'needs_reconfirm'
  AND suspended_reason = 'document_metadata_changed';
