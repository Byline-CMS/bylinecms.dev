CREATE TABLE "byline_document_publish_schedules" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"target_version_id" uuid NOT NULL,
	"publish_at" timestamp (6) with time zone NOT NULL,
	"state" varchar(32) DEFAULT 'armed' NOT NULL,
	"suspended_at" timestamp (6) with time zone,
	"suspended_reason" varchar(32),
	"scheduled_by" uuid,
	"last_authorized_by" uuid,
	"last_authorized_at" timestamp (6) with time zone NOT NULL,
	"scheduled_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"execution_token" uuid,
	"execution_expires_at" timestamp (6) with time zone,
	"last_attempt_at" timestamp (6) with time zone,
	"next_attempt_at" timestamp (6) with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "check_document_publish_schedules_state" CHECK ("byline_document_publish_schedules"."state" IN ('armed', 'needs_reconfirm')),
	CONSTRAINT "check_document_publish_schedules_suspended_reason" CHECK ("byline_document_publish_schedules"."suspended_reason" IS NULL OR "byline_document_publish_schedules"."suspended_reason" = 'content_edited')
);
--> statement-breakpoint
ALTER TABLE "byline_document_publish_schedules" ADD CONSTRAINT "byline_document_publish_schedules_document_id_byline_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_publish_schedules" ADD CONSTRAINT "byline_document_publish_schedules_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_publish_schedules" ADD CONSTRAINT "byline_document_publish_schedules_target_version_id_byline_document_versions_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_publish_schedules_due" ON "byline_document_publish_schedules" USING btree ("next_attempt_at","publish_at") WHERE "byline_document_publish_schedules"."state" = 'armed';--> statement-breakpoint
CREATE INDEX "idx_document_publish_schedules_execution_expiry" ON "byline_document_publish_schedules" USING btree ("execution_expires_at");