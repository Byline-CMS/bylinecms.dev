CREATE TABLE "byline_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid,
	"collection_id" uuid,
	"actor_id" uuid,
	"actor_realm" varchar(16) NOT NULL,
	"action" varchar(64) NOT NULL,
	"field" varchar(128),
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_audit_log_document_id" ON "byline_audit_log" USING btree ("document_id","id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_actor_id" ON "byline_audit_log" USING btree ("actor_id","id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "byline_audit_log" USING btree ("action","id");