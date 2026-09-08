CREATE TABLE `byline_admin_sign_in_rate_limits` (
	`key` varchar(64) NOT NULL,
	`attempts` int NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `byline_admin_sign_in_rate_limits_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE INDEX `idx_admin_sign_in_rate_limits_expiry` ON `byline_admin_sign_in_rate_limits` (`expires_at`);