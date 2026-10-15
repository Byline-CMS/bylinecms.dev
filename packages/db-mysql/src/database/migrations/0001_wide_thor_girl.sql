CREATE TABLE `byline_admin_passkey_attempts` (
	`token_hash` varbinary(64) NOT NULL,
	`purpose` varchar(24) NOT NULL,
	`challenge` varchar(43),
	`actor_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_login_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_generation` int,
	`action` varchar(8),
	`target_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`credential_record_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`proof_credential_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`created_at` datetime(6) NOT NULL,
	`expires_at` datetime(6) NOT NULL,
	`consumed_at` datetime(6),
	CONSTRAINT `byline_admin_passkey_attempts_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_passkey_credentials` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`admin_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`credential_id` varbinary(1366) NOT NULL,
	`public_key` text NOT NULL,
	`counter` bigint NOT NULL,
	`transports` json NOT NULL,
	`backup_eligible` boolean NOT NULL,
	`backed_up` boolean NOT NULL,
	`name` varchar(80) NOT NULL,
	`created_at` datetime(6) NOT NULL,
	`last_used_at` datetime(6),
	`revoked_at` datetime(6),
	CONSTRAINT `byline_admin_passkey_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `byline_admin_passkey_credentials_credential_id_unique` UNIQUE(`credential_id`)
);
--> statement-breakpoint
ALTER TABLE `byline_admin_users` ADD `webauthn_user_handle` varbinary(43);--> statement-breakpoint
ALTER TABLE `byline_admin_users` ADD CONSTRAINT `byline_admin_users_webauthn_user_handle_unique` UNIQUE(`webauthn_user_handle`);--> statement-breakpoint
ALTER TABLE `byline_admin_passkey_credentials` ADD CONSTRAINT `fk_admin_passkeys_user` FOREIGN KEY (`admin_user_id`) REFERENCES `byline_admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_admin_passkey_attempts_expiry` ON `byline_admin_passkey_attempts` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_passkey_attempts_login` ON `byline_admin_passkey_attempts` (`actor_login_id`);--> statement-breakpoint
CREATE INDEX `idx_admin_passkeys_user` ON `byline_admin_passkey_credentials` (`admin_user_id`);