ALTER TABLE `byline_document_paths` ADD `deleted_at` datetime(6);--> statement-breakpoint
ALTER TABLE `byline_document_paths` ADD `alive` boolean GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN true ELSE NULL END) STORED;--> statement-breakpoint
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
	AND COALESCE(`version_state`.`has_live_version`, 0) = 0;--> statement-breakpoint
ALTER TABLE `byline_document_paths`
	DROP INDEX `idx_document_paths_collection_locale_path`,
	ADD CONSTRAINT `idx_document_paths_collection_locale_path` UNIQUE(`collection_id`,`locale`,`path`,`alive`);
