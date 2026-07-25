ALTER TABLE `byline_admin_permissions` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_permissions` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `issued_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `expires_at` datetime(6) NOT NULL;--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `revoked_at` datetime(6);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `last_used_at` datetime(6);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_refresh_tokens` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_role_admin_user` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_roles` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_roles` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_user_preferences` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_user_preferences` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_users` MODIFY COLUMN `last_login` datetime(6);--> statement-breakpoint
ALTER TABLE `byline_admin_users` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_admin_users` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_audit_log` MODIFY COLUMN `occurred_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_boolean` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_boolean` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_collections` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_collections` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_counter_groups` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_datetime` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_datetime` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_datetime` MODIFY COLUMN `value_timestamp_tz` datetime(6);--> statement-breakpoint
ALTER TABLE `byline_document_available_locales` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_available_locales` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_paths` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_paths` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_relationships` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_relationships` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_versions` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_document_versions` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_documents` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_documents` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_file` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_file` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_json` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_json` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_meta` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_meta` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_numeric` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_numeric` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_relation` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_relation` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_text` MODIFY COLUMN `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);--> statement-breakpoint
ALTER TABLE `byline_store_text` MODIFY COLUMN `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);