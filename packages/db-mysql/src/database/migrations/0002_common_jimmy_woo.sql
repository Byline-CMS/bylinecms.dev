ALTER TABLE `byline_admin_refresh_tokens` ADD `session_version` int DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE `byline_admin_users` ADD `session_version` int DEFAULT 0 NOT NULL;