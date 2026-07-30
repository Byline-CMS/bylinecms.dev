CREATE TABLE `byline_admin_permissions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`vid` int NOT NULL DEFAULT 1,
	`admin_role_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`ability` varchar(128) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_byline_admin_permissions_role_ability` UNIQUE(`admin_role_id`,`ability`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_refresh_tokens` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`admin_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`issued_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`expires_at` datetime(6) NOT NULL,
	`revoked_at` datetime(6),
	`rotated_to_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`last_used_at` datetime(6),
	`user_agent` varchar(512),
	`ip` varchar(45),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `byline_admin_refresh_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_role_admin_user` (
	`admin_role_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`admin_user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_role_admin_user_admin_role_id_admin_user_id_pk` PRIMARY KEY(`admin_role_id`,`admin_user_id`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_roles` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`vid` int NOT NULL DEFAULT 1,
	`name` varchar(128) NOT NULL,
	`machine_name` varchar(128) NOT NULL,
	`description` text,
	`order` int NOT NULL DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `byline_admin_roles_machine_name_unique` UNIQUE(`machine_name`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_user_preferences` (
	`user_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`scope` varchar(255) NOT NULL,
	`value` json NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_user_preferences_user_id_scope_pk` PRIMARY KEY(`user_id`,`scope`)
);
--> statement-breakpoint
CREATE TABLE `byline_admin_users` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`vid` int NOT NULL DEFAULT 1,
	`given_name` varchar(100),
	`family_name` varchar(100),
	`username` varchar(64),
	`email` varchar(254) NOT NULL,
	`password` varchar(255) NOT NULL,
	`remember_me` boolean NOT NULL DEFAULT false,
	`last_login` datetime(6),
	`last_login_ip` varchar(45),
	`failed_login_attempts` int NOT NULL DEFAULT 0,
	`is_super_admin` boolean NOT NULL DEFAULT false,
	`is_enabled` boolean NOT NULL DEFAULT false,
	`is_email_verified` boolean NOT NULL DEFAULT false,
	`preferred_locale` varchar(16),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `byline_admin_users_username_unique` UNIQUE(`username`),
	CONSTRAINT `byline_admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `byline_audit_log` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`actor_realm` varchar(16) NOT NULL,
	`action` varchar(64) NOT NULL,
	`field` varchar(128),
	`before` json,
	`after` json,
	`occurred_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_boolean` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`value` boolean NOT NULL,
	CONSTRAINT `byline_store_boolean_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_boolean_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_collections` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`path` varchar(255) NOT NULL,
	`singular` text NOT NULL,
	`plural` text NOT NULL,
	`config` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`schema_hash` varchar(64),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_collections_id` PRIMARY KEY(`id`),
	CONSTRAINT `byline_collections_path_unique` UNIQUE(`path`)
);
--> statement-breakpoint
CREATE TABLE `byline_counter_groups` (
	`group_name` varchar(255) NOT NULL,
	`sequence_name` text NOT NULL,
	`current_value` bigint NOT NULL DEFAULT 0,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_counter_groups_group_name` PRIMARY KEY(`group_name`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_datetime` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`date_type` varchar(20) NOT NULL,
	`value_date` date,
	`value_time` time(3),
	`value_timestamp_tz` datetime(6),
	CONSTRAINT `byline_store_datetime_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_datetime_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_document_available_locales` (
	`document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`locale` varchar(10) NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_document_available_locales_document_id_locale_pk` PRIMARY KEY(`document_id`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_document_paths` (
	`document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`locale` varchar(10) NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`path` varchar(255) COLLATE utf8mb4_bin NOT NULL,
	`deleted_at` datetime(6),
	`alive` boolean GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN true ELSE NULL END) STORED,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `unique_document_paths_document_locale` UNIQUE(`document_id`,`locale`),
	CONSTRAINT `idx_document_paths_collection_locale_path` UNIQUE(`collection_id`,`locale`,`path`,`alive`)
);
--> statement-breakpoint
CREATE TABLE `byline_document_relationships` (
	`child_document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`parent_document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`order_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `uq_document_relationships_child` UNIQUE(`child_document_id`)
);
--> statement-breakpoint
CREATE TABLE `byline_document_version_locales` (
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`locale` varchar(10) NOT NULL,
	CONSTRAINT `byline_document_version_locales_document_version_id_locale_pk` PRIMARY KEY(`document_version_id`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_document_versions` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_version` int NOT NULL,
	`doc` json,
	`event_type` varchar(20) NOT NULL DEFAULT 'create',
	`status` varchar(50) DEFAULT 'draft',
	`is_deleted` boolean DEFAULT false,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`created_by` char(36) CHARACTER SET ascii COLLATE ascii_bin,
	`change_summary` text,
	CONSTRAINT `byline_document_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `byline_documents` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`order_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin,
	`source_locale` varchar(10) NOT NULL,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_file` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`file_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`filename` varchar(255) NOT NULL,
	`original_filename` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`file_size` bigint NOT NULL,
	`file_hash` varchar(64),
	`storage_provider` varchar(50) NOT NULL,
	`storage_path` text NOT NULL,
	`storage_url` text,
	`image_width` int,
	`image_height` int,
	`image_format` varchar(20),
	`processing_status` varchar(20) DEFAULT 'pending',
	`thumbnail_generated` boolean DEFAULT false,
	`variants` json,
	CONSTRAINT `byline_store_file_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_file_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_json` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`value` json NOT NULL,
	`json_schema` varchar(100),
	`object_keys` json,
	CONSTRAINT `byline_store_json_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_json_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_meta` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`type` varchar(50) NOT NULL,
	`path` varchar(512) NOT NULL,
	`item_id` varchar(255) NOT NULL,
	`meta` json,
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	CONSTRAINT `byline_store_meta_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_meta_node` UNIQUE(`document_version_id`,`type`,`path`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_numeric` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`number_type` varchar(20) NOT NULL,
	`value_integer` int,
	`value_decimal` decimal(10,2),
	`value_float` float,
	CONSTRAINT `byline_store_numeric_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_numeric_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_relation` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`target_document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`target_collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`relationship_type` varchar(50) DEFAULT 'reference',
	`cascade_delete` boolean DEFAULT false,
	CONSTRAINT `byline_store_relation_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_relation_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `byline_store_text` (
	`id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_version_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`field_path` varchar(500) NOT NULL,
	`field_name` varchar(255) NOT NULL,
	`locale` varchar(10) NOT NULL DEFAULT 'default',
	`parent_path` varchar(500),
	`created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
	`value` text NOT NULL,
	`word_count` int,
	CONSTRAINT `byline_store_text_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_text_field` UNIQUE(`document_version_id`,`field_path`,`locale`)
);
--> statement-breakpoint
ALTER TABLE `byline_admin_permissions` ADD CONSTRAINT `fk_admin_permissions_admin_role_id` FOREIGN KEY (`admin_role_id`) REFERENCES `byline_admin_roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` ADD CONSTRAINT `fk_admin_refresh_tokens_admin_user_id` FOREIGN KEY (`admin_user_id`) REFERENCES `byline_admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_admin_role_admin_user` ADD CONSTRAINT `fk_admin_role_admin_user_admin_role_id` FOREIGN KEY (`admin_role_id`) REFERENCES `byline_admin_roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_admin_role_admin_user` ADD CONSTRAINT `fk_admin_role_admin_user_admin_user_id` FOREIGN KEY (`admin_user_id`) REFERENCES `byline_admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_admin_user_preferences` ADD CONSTRAINT `fk_admin_user_preferences_user_id` FOREIGN KEY (`user_id`) REFERENCES `byline_admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_boolean` ADD CONSTRAINT `fk_store_boolean_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_boolean` ADD CONSTRAINT `fk_store_boolean_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_datetime` ADD CONSTRAINT `fk_store_datetime_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_datetime` ADD CONSTRAINT `fk_store_datetime_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_available_locales` ADD CONSTRAINT `fk_document_available_locales_document_id` FOREIGN KEY (`document_id`) REFERENCES `byline_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_available_locales` ADD CONSTRAINT `fk_document_available_locales_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_paths` ADD CONSTRAINT `fk_document_paths_document_id` FOREIGN KEY (`document_id`) REFERENCES `byline_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_paths` ADD CONSTRAINT `fk_document_paths_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_relationships` ADD CONSTRAINT `fk_document_relationships_child_document_id` FOREIGN KEY (`child_document_id`) REFERENCES `byline_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_relationships` ADD CONSTRAINT `fk_document_relationships_parent_document_id` FOREIGN KEY (`parent_document_id`) REFERENCES `byline_documents`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_version_locales` ADD CONSTRAINT `fk_document_version_locales_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_versions` ADD CONSTRAINT `fk_document_versions_document_id` FOREIGN KEY (`document_id`) REFERENCES `byline_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_document_versions` ADD CONSTRAINT `fk_document_versions_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_documents` ADD CONSTRAINT `fk_documents_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_file` ADD CONSTRAINT `fk_store_file_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_file` ADD CONSTRAINT `fk_store_file_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_json` ADD CONSTRAINT `fk_store_json_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_json` ADD CONSTRAINT `fk_store_json_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_meta` ADD CONSTRAINT `fk_store_meta_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_meta` ADD CONSTRAINT `fk_store_meta_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_numeric` ADD CONSTRAINT `fk_store_numeric_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_numeric` ADD CONSTRAINT `fk_store_numeric_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_relation` ADD CONSTRAINT `fk_store_relation_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_relation` ADD CONSTRAINT `fk_store_relation_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_relation` ADD CONSTRAINT `fk_store_relation_target_document_id` FOREIGN KEY (`target_document_id`) REFERENCES `byline_documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_relation` ADD CONSTRAINT `fk_store_relation_target_collection_id` FOREIGN KEY (`target_collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_text` ADD CONSTRAINT `fk_store_text_document_version_id` FOREIGN KEY (`document_version_id`) REFERENCES `byline_document_versions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `byline_store_text` ADD CONSTRAINT `fk_store_text_collection_id` FOREIGN KEY (`collection_id`) REFERENCES `byline_collections`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_byline_admin_permissions_role` ON `byline_admin_permissions` (`admin_role_id`);--> statement-breakpoint
CREATE INDEX `idx_byline_admin_refresh_tokens_user` ON `byline_admin_refresh_tokens` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `idx_byline_admin_refresh_tokens_token_hash` ON `byline_admin_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_byline_admin_role_admin_user_user` ON `byline_admin_role_admin_user` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `idx_byline_admin_roles_machine_name` ON `byline_admin_roles` (`machine_name`);--> statement-breakpoint
CREATE INDEX `idx_byline_admin_users_email` ON `byline_admin_users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_document_id` ON `byline_audit_log` (`document_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_actor_id` ON `byline_audit_log` (`actor_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_action` ON `byline_audit_log` (`action`,`id`);--> statement-breakpoint
CREATE INDEX `idx_boolean_value` ON `byline_store_boolean` (`value`);--> statement-breakpoint
CREATE INDEX `idx_boolean_path_value` ON `byline_store_boolean` (`field_path`,`value`);--> statement-breakpoint
CREATE INDEX `idx_boolean_collection_value` ON `byline_store_boolean` (`collection_id`,`field_path`,`value`);--> statement-breakpoint
CREATE INDEX `idx_datetime_date` ON `byline_store_datetime` (`value_date`);--> statement-breakpoint
CREATE INDEX `idx_datetime_timestamp_tz` ON `byline_store_datetime` (`value_timestamp_tz`);--> statement-breakpoint
CREATE INDEX `idx_datetime_path_date` ON `byline_store_datetime` (`field_path`,`value_timestamp_tz`);--> statement-breakpoint
CREATE INDEX `idx_datetime_collection_date` ON `byline_store_datetime` (`collection_id`,`value_timestamp_tz`);--> statement-breakpoint
CREATE INDEX `idx_document_available_locales_document_id` ON `byline_document_available_locales` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_paths_document_id` ON `byline_document_paths` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_relationships_parent_order` ON `byline_document_relationships` (`parent_document_id`,`order_key`);--> statement-breakpoint
CREATE INDEX `idx_documents_document_id` ON `byline_document_versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_collection_document_deleted` ON `byline_document_versions` (`collection_id`,`document_id`,`is_deleted`);--> statement-breakpoint
CREATE INDEX `idx_documents_current_view` ON `byline_document_versions` (`collection_id`,`document_id`,`is_deleted`,`id`);--> statement-breakpoint
CREATE INDEX `idx_documents_event_type` ON `byline_document_versions` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_documents_created_at` ON `byline_document_versions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_document_collection` ON `byline_document_versions` (`document_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_collection` ON `byline_documents` (`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_collection_order` ON `byline_documents` (`collection_id`,`order_key`);--> statement-breakpoint
CREATE INDEX `idx_file_file_id` ON `byline_store_file` (`file_id`);--> statement-breakpoint
CREATE INDEX `idx_file_mime_type` ON `byline_store_file` (`mime_type`);--> statement-breakpoint
CREATE INDEX `idx_file_size` ON `byline_store_file` (`file_size`);--> statement-breakpoint
CREATE INDEX `idx_file_hash` ON `byline_store_file` (`file_hash`);--> statement-breakpoint
CREATE INDEX `idx_file_image_dimensions` ON `byline_store_file` (`image_width`,`image_height`);--> statement-breakpoint
CREATE INDEX `idx_file_storage_provider` ON `byline_store_file` (`storage_provider`);--> statement-breakpoint
CREATE INDEX `idx_file_processing_status` ON `byline_store_file` (`processing_status`);--> statement-breakpoint
CREATE INDEX `idx_json_schema` ON `byline_store_json` (`json_schema`);--> statement-breakpoint
CREATE INDEX `idx_meta_document_type_path` ON `byline_store_meta` (`document_version_id`,`type`,`path`);--> statement-breakpoint
CREATE INDEX `idx_meta_item_id` ON `byline_store_meta` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_meta_collection_type` ON `byline_store_meta` (`collection_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_numeric_integer` ON `byline_store_numeric` (`value_integer`);--> statement-breakpoint
CREATE INDEX `idx_numeric_decimal` ON `byline_store_numeric` (`value_decimal`);--> statement-breakpoint
CREATE INDEX `idx_numeric_float` ON `byline_store_numeric` (`value_float`);--> statement-breakpoint
CREATE INDEX `idx_numeric_integer_range` ON `byline_store_numeric` (`field_path`,`value_integer`);--> statement-breakpoint
CREATE INDEX `idx_numeric_decimal_range` ON `byline_store_numeric` (`field_path`,`value_decimal`);--> statement-breakpoint
CREATE INDEX `idx_relation_target_document` ON `byline_store_relation` (`target_document_id`);--> statement-breakpoint
CREATE INDEX `idx_relation_target_collection` ON `byline_store_relation` (`target_collection_id`);--> statement-breakpoint
CREATE INDEX `idx_relation_type` ON `byline_store_relation` (`relationship_type`);--> statement-breakpoint
CREATE INDEX `idx_relation_reverse` ON `byline_store_relation` (`target_document_id`,`field_path`);--> statement-breakpoint
CREATE INDEX `idx_relation_collection_to_collection` ON `byline_store_relation` (`collection_id`,`target_collection_id`);--> statement-breakpoint
CREATE INDEX `idx_text_value` ON `byline_store_text` (`value`(191));--> statement-breakpoint
CREATE INDEX `idx_text_locale_value` ON `byline_store_text` (`locale`,`value`(191));--> statement-breakpoint
CREATE INDEX `idx_text_path_value` ON `byline_store_text` (`field_path`,`value`(191));--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `byline_current_documents` AS (with `sq` as (select `id`, `document_id`, `collection_id`, `collection_version`, `event_type`, `status`, `is_deleted`, `created_at`, `updated_at`, `created_by`, `change_summary`, row_number() OVER (PARTITION BY `document_id` ORDER BY `id` DESC) as `rn` from `byline_document_versions` where `byline_document_versions`.`is_deleted` = false) select `sq`.`id`, `sq`.`document_id`, `sq`.`collection_id`, `sq`.`collection_version`, `sq`.`event_type`, `sq`.`status`, `sq`.`is_deleted`, `sq`.`created_at`, `sq`.`updated_at`, `sq`.`created_by`, `sq`.`change_summary`, `byline_documents`.`order_key`, `byline_documents`.`source_locale` from `sq` inner join `byline_documents` on `byline_documents`.`id` = `sq`.`document_id` where `rn` = 1);--> statement-breakpoint
CREATE ALGORITHM = undefined
SQL SECURITY definer
VIEW `byline_current_published_documents` AS (with `sq` as (select `id`, `document_id`, `collection_id`, `collection_version`, `event_type`, `status`, `is_deleted`, `created_at`, `updated_at`, `created_by`, `change_summary`, row_number() OVER (PARTITION BY `document_id` ORDER BY `id` DESC) as `rn` from `byline_document_versions` where `byline_document_versions`.`is_deleted` = false AND `byline_document_versions`.`status` = 'published') select `sq`.`id`, `sq`.`document_id`, `sq`.`collection_id`, `sq`.`collection_version`, `sq`.`event_type`, `sq`.`status`, `sq`.`is_deleted`, `sq`.`created_at`, `sq`.`updated_at`, `sq`.`created_by`, `sq`.`change_summary`, `byline_documents`.`order_key`, `byline_documents`.`source_locale` from `sq` inner join `byline_documents` on `byline_documents`.`id` = `sq`.`document_id` where `rn` = 1);