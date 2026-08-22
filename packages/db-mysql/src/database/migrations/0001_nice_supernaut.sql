CREATE TABLE `byline_recurring_tasks` (
	`name` varchar(255) NOT NULL,
	`interval_ms` bigint NOT NULL,
	`next_run_at` datetime(6) NOT NULL,
	`lease_token` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`lease_owner` varchar(255),
	`lease_expires_at` datetime(6),
	`last_started_at` datetime(6),
	`last_succeeded_at` datetime(6),
	`last_failed_at` datetime(6),
	`last_duration_ms` bigint,
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`last_status` varchar(32) NOT NULL DEFAULT 'never_run',
	`last_error` text,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_recurring_tasks_name` PRIMARY KEY(`name`)
);
