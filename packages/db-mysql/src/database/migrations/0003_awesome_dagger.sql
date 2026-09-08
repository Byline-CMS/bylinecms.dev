CREATE TABLE `byline_admin_login_sessions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`admin_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`session_version` int NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`revoked_at` datetime(6),
	CONSTRAINT `byline_admin_login_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` ADD `sid` char(36) CHARACTER SET ascii COLLATE ascii_bin;--> statement-breakpoint
ALTER TABLE `byline_admin_login_sessions` ADD CONSTRAINT `fk_admin_login_sessions_user` FOREIGN KEY (`admin_user_id`) REFERENCES `byline_admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_login_sessions_user` ON `byline_admin_login_sessions` (`admin_user_id`);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` ADD CONSTRAINT `fk_admin_refresh_tokens_sid` FOREIGN KEY (`sid`) REFERENCES `byline_admin_login_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_refresh_tokens_sid` ON `byline_admin_refresh_tokens` (`sid`);