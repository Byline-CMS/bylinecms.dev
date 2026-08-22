CREATE TABLE `byline_document_publish_schedules` (
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
	CONSTRAINT `byline_document_publish_schedules_document_id` PRIMARY KEY(`document_id`),
	CONSTRAINT `check_publish_schedules_state` CHECK(`byline_document_publish_schedules`.`state` IN ('armed', 'needs_reconfirm')),
	CONSTRAINT `check_publish_schedules_suspended_reason` CHECK(`byline_document_publish_schedules`.`suspended_reason` IS NULL OR `byline_document_publish_schedules`.`suspended_reason` = 'content_edited')
);
--> statement-breakpoint
ALTER TABLE `byline_document_publish_schedules` ADD CONSTRAINT `fk_publish_schedules_document` FOREIGN KEY (`document_id`) REFERENCES `byline_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_publish_schedules` ADD CONSTRAINT `fk_publish_schedules_collection` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_publish_schedules` ADD CONSTRAINT `fk_publish_schedules_target_version` FOREIGN KEY (`target_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_document_publish_schedules_due` ON `byline_document_publish_schedules` (`state`,`next_attempt_at`,`publish_at`);--> statement-breakpoint
CREATE INDEX `idx_document_publish_schedules_execution_expiry` ON `byline_document_publish_schedules` (`execution_expires_at`);