CREATE INDEX `idx_admin_login_sessions_expiry` ON `byline_admin_login_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_login_sessions_revoked` ON `byline_admin_login_sessions` (`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_passkey_attempts_consumed` ON `byline_admin_passkey_attempts` (`consumed_at`);--> statement-breakpoint
CREATE INDEX `idx_admin_refresh_tokens_legacy_expiry` ON `byline_admin_refresh_tokens` (`sid`,`expires_at`);