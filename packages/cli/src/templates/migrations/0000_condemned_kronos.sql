CREATE TABLE "byline_admin_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"admin_role_id" uuid NOT NULL,
	"ability" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_byline_admin_permissions_role_ability" UNIQUE("admin_role_id","ability")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"issued_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"revoked_at" timestamp (6) with time zone,
	"rotated_to_id" uuid,
	"last_used_at" timestamp (6) with time zone,
	"user_agent" varchar(512),
	"ip" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_role_admin_user" (
	"admin_role_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_role_admin_user_admin_role_id_admin_user_id_pk" PRIMARY KEY("admin_role_id","admin_user_id")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"name" varchar(128) NOT NULL,
	"machine_name" varchar(128) NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_roles_machine_name_unique" UNIQUE("machine_name")
);
--> statement-breakpoint
CREATE TABLE "byline_admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vid" integer DEFAULT 1 NOT NULL,
	"given_name" varchar(100),
	"family_name" varchar(100),
	"username" varchar(64),
	"email" varchar(254) NOT NULL,
	"password" varchar(255) NOT NULL,
	"remember_me" boolean DEFAULT false NOT NULL,
	"last_login" timestamp (6) with time zone,
	"last_login_ip" varchar(45),
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_users_username_unique" UNIQUE("username"),
	CONSTRAINT "byline_admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "byline_store_boolean" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"value" boolean NOT NULL,
	CONSTRAINT "unique_boolean_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path" varchar(255) NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema_hash" varchar(64),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "byline_collections_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "byline_store_datetime" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"date_type" varchar(20) NOT NULL,
	"value_date" date,
	"value_time" time,
	"value_timestamp_tz" timestamp with time zone,
	CONSTRAINT "unique_datetime_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_document_relationships" (
	"parent_document_id" uuid NOT NULL,
	"child_document_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "byline_document_relationships_parent_document_id_child_document_id_unique" UNIQUE("parent_document_id","child_document_id")
);
--> statement-breakpoint
CREATE TABLE "byline_document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"collection_version" integer NOT NULL,
	"path" varchar(255) NOT NULL,
	"doc" jsonb,
	"event_type" varchar(20) DEFAULT 'create' NOT NULL,
	"status" varchar(50) DEFAULT 'draft',
	"is_deleted" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" uuid,
	"change_summary" text
);
--> statement-breakpoint
CREATE TABLE "byline_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "byline_store_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"file_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" bigint NOT NULL,
	"file_hash" varchar(64),
	"storage_provider" varchar(50) NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"image_width" integer,
	"image_height" integer,
	"image_format" varchar(20),
	"processing_status" varchar(20) DEFAULT 'pending',
	"thumbnail_generated" boolean DEFAULT false,
	CONSTRAINT "unique_file_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_store_json" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"value" jsonb NOT NULL,
	"json_schema" varchar(100),
	"object_keys" text[],
	CONSTRAINT "unique_json_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_store_meta" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"type" text NOT NULL,
	"path" text NOT NULL,
	"item_id" varchar(255) NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "unique_meta_node" UNIQUE("document_version_id","type","path")
);
--> statement-breakpoint
CREATE TABLE "byline_store_numeric" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"number_type" varchar(20) NOT NULL,
	"value_integer" integer,
	"value_decimal" numeric(10, 2),
	"value_float" real,
	CONSTRAINT "unique_numeric_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_store_relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"target_document_id" uuid NOT NULL,
	"target_collection_id" uuid NOT NULL,
	"relationship_type" varchar(50) DEFAULT 'reference',
	"cascade_delete" boolean DEFAULT false,
	CONSTRAINT "unique_relation_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
CREATE TABLE "byline_store_text" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_version_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"field_path" varchar(500) NOT NULL,
	"field_name" varchar(255) NOT NULL,
	"locale" varchar(10) DEFAULT 'default' NOT NULL,
	"parent_path" varchar(500),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"value" text NOT NULL,
	"word_count" integer,
	CONSTRAINT "unique_text_field" UNIQUE("document_version_id","field_path","locale")
);
--> statement-breakpoint
ALTER TABLE "byline_admin_permissions" ADD CONSTRAINT "byline_admin_permissions_admin_role_id_byline_admin_roles_id_fk" FOREIGN KEY ("admin_role_id") REFERENCES "public"."byline_admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_admin_refresh_tokens" ADD CONSTRAINT "byline_admin_refresh_tokens_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_admin_role_admin_user" ADD CONSTRAINT "byline_admin_role_admin_user_admin_role_id_byline_admin_roles_id_fk" FOREIGN KEY ("admin_role_id") REFERENCES "public"."byline_admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_admin_role_admin_user" ADD CONSTRAINT "byline_admin_role_admin_user_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_boolean" ADD CONSTRAINT "byline_store_boolean_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_boolean" ADD CONSTRAINT "byline_store_boolean_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_datetime" ADD CONSTRAINT "byline_store_datetime_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_datetime" ADD CONSTRAINT "byline_store_datetime_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD CONSTRAINT "byline_document_relationships_parent_document_id_byline_documents_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD CONSTRAINT "byline_document_relationships_child_document_id_byline_documents_id_fk" FOREIGN KEY ("child_document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_versions" ADD CONSTRAINT "byline_document_versions_document_id_byline_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_versions" ADD CONSTRAINT "byline_document_versions_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_documents" ADD CONSTRAINT "byline_documents_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_file" ADD CONSTRAINT "byline_store_file_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_file" ADD CONSTRAINT "byline_store_file_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_json" ADD CONSTRAINT "byline_store_json_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_json" ADD CONSTRAINT "byline_store_json_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_meta" ADD CONSTRAINT "byline_store_meta_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_meta" ADD CONSTRAINT "byline_store_meta_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_numeric" ADD CONSTRAINT "byline_store_numeric_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_numeric" ADD CONSTRAINT "byline_store_numeric_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_relation" ADD CONSTRAINT "byline_store_relation_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_relation" ADD CONSTRAINT "byline_store_relation_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_relation" ADD CONSTRAINT "byline_store_relation_target_document_id_byline_documents_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."byline_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_relation" ADD CONSTRAINT "byline_store_relation_target_collection_id_byline_collections_id_fk" FOREIGN KEY ("target_collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_text" ADD CONSTRAINT "byline_store_text_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_store_text" ADD CONSTRAINT "byline_store_text_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_byline_admin_permissions_role" ON "byline_admin_permissions" USING btree ("admin_role_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_refresh_tokens_user" ON "byline_admin_refresh_tokens" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_refresh_tokens_token_hash" ON "byline_admin_refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_role_admin_user_user" ON "byline_admin_role_admin_user" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_roles_machine_name" ON "byline_admin_roles" USING btree ("machine_name");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_users_email" ON "byline_admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_boolean_value" ON "byline_store_boolean" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_boolean_path_value" ON "byline_store_boolean" USING btree ("field_path","value");--> statement-breakpoint
CREATE INDEX "idx_boolean_collection_value" ON "byline_store_boolean" USING btree ("collection_id","field_path","value");--> statement-breakpoint
CREATE INDEX "idx_datetime_date" ON "byline_store_datetime" USING btree ("value_date");--> statement-breakpoint
CREATE INDEX "idx_datetime_timestamp_tz" ON "byline_store_datetime" USING btree ("value_timestamp_tz");--> statement-breakpoint
CREATE INDEX "idx_datetime_path_date" ON "byline_store_datetime" USING btree ("field_path","value_timestamp_tz");--> statement-breakpoint
CREATE INDEX "idx_datetime_collection_date" ON "byline_store_datetime" USING btree ("collection_id","value_timestamp_tz");--> statement-breakpoint
CREATE INDEX "idx_document_relationships_parent" ON "byline_document_relationships" USING btree ("parent_document_id");--> statement-breakpoint
CREATE INDEX "idx_document_relationships_child" ON "byline_document_relationships" USING btree ("child_document_id");--> statement-breakpoint
CREATE INDEX "idx_documents_document_id" ON "byline_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_documents_collection_path_deleted" ON "byline_document_versions" USING btree ("collection_id","path","is_deleted");--> statement-breakpoint
CREATE INDEX "idx_documents_collection_document_deleted" ON "byline_document_versions" USING btree ("collection_id","document_id","is_deleted");--> statement-breakpoint
CREATE INDEX "idx_documents_current_view" ON "byline_document_versions" USING btree ("collection_id","document_id","is_deleted","id");--> statement-breakpoint
CREATE INDEX "idx_documents_event_type" ON "byline_document_versions" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_documents_created_at" ON "byline_document_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_documents_document_collection" ON "byline_document_versions" USING btree ("document_id","collection_id");--> statement-breakpoint
CREATE INDEX "idx_documents_collection" ON "byline_documents" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "idx_file_file_id" ON "byline_store_file" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "idx_file_mime_type" ON "byline_store_file" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "idx_file_size" ON "byline_store_file" USING btree ("file_size");--> statement-breakpoint
CREATE INDEX "idx_file_hash" ON "byline_store_file" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "idx_file_image_dimensions" ON "byline_store_file" USING btree ("image_width","image_height");--> statement-breakpoint
CREATE INDEX "idx_file_storage_provider" ON "byline_store_file" USING btree ("storage_provider");--> statement-breakpoint
CREATE INDEX "idx_file_processing_status" ON "byline_store_file" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "idx_json_value_gin" ON "byline_store_json" USING gin ("value");--> statement-breakpoint
CREATE INDEX "idx_json_schema" ON "byline_store_json" USING btree ("json_schema");--> statement-breakpoint
CREATE INDEX "idx_json_keys" ON "byline_store_json" USING gin ("object_keys");--> statement-breakpoint
CREATE INDEX "idx_meta_document_type_path" ON "byline_store_meta" USING btree ("document_version_id","type","path");--> statement-breakpoint
CREATE INDEX "idx_meta_item_id" ON "byline_store_meta" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_meta_collection_type" ON "byline_store_meta" USING btree ("collection_id","type");--> statement-breakpoint
CREATE INDEX "idx_numeric_integer" ON "byline_store_numeric" USING btree ("value_integer");--> statement-breakpoint
CREATE INDEX "idx_numeric_decimal" ON "byline_store_numeric" USING btree ("value_decimal");--> statement-breakpoint
CREATE INDEX "idx_numeric_float" ON "byline_store_numeric" USING btree ("value_float");--> statement-breakpoint
CREATE INDEX "idx_numeric_integer_range" ON "byline_store_numeric" USING btree ("field_path","value_integer");--> statement-breakpoint
CREATE INDEX "idx_numeric_decimal_range" ON "byline_store_numeric" USING btree ("field_path","value_decimal");--> statement-breakpoint
CREATE INDEX "idx_relation_target_document" ON "byline_store_relation" USING btree ("target_document_id");--> statement-breakpoint
CREATE INDEX "idx_relation_target_collection" ON "byline_store_relation" USING btree ("target_collection_id");--> statement-breakpoint
CREATE INDEX "idx_relation_type" ON "byline_store_relation" USING btree ("relationship_type");--> statement-breakpoint
CREATE INDEX "idx_relation_reverse" ON "byline_store_relation" USING btree ("target_document_id","field_path");--> statement-breakpoint
CREATE INDEX "idx_relation_collection_to_collection" ON "byline_store_relation" USING btree ("collection_id","target_collection_id");--> statement-breakpoint
CREATE INDEX "idx_text_value" ON "byline_store_text" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_text_fulltext" ON "byline_store_text" USING gin (to_tsvector('english', "value"));--> statement-breakpoint
CREATE INDEX "idx_text_locale_value" ON "byline_store_text" USING btree ("locale","value");--> statement-breakpoint
CREATE INDEX "idx_text_path_value" ON "byline_store_text" USING btree ("field_path","value");--> statement-breakpoint
CREATE VIEW "public"."byline_current_documents" AS (with "sq" as (select "id", "document_id", "collection_id", "collection_version", "path", "event_type", "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary", row_number() OVER (PARTITION BY "document_id" ORDER BY "id" DESC) as "rn" from "byline_document_versions" where "byline_document_versions"."is_deleted" = false) select "id", "document_id", "collection_id", "collection_version", "path", "event_type", "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary" from "sq" where "rn" = 1);--> statement-breakpoint
CREATE VIEW "public"."byline_current_published_documents" AS (with "sq" as (select "id", "document_id", "collection_id", "collection_version", "path", "event_type", "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary", row_number() OVER (PARTITION BY "document_id" ORDER BY "id" DESC) as "rn" from "byline_document_versions" where "byline_document_versions"."is_deleted" = false AND "byline_document_versions"."status" = 'published') select "id", "document_id", "collection_id", "collection_version", "path", "event_type", "status", "is_deleted", "created_at", "updated_at", "created_by", "change_summary" from "sq" where "rn" = 1);