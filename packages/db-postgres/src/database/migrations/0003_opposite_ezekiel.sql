CREATE TABLE "byline_admin_login_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"session_version" integer NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"revoked_at" timestamp (6) with time zone
);
--> statement-breakpoint
ALTER TABLE "byline_admin_refresh_tokens" ADD COLUMN "sid" uuid;--> statement-breakpoint
ALTER TABLE "byline_admin_login_sessions" ADD CONSTRAINT "byline_admin_login_sessions_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_login_sessions_user" ON "byline_admin_login_sessions" USING btree ("admin_user_id");--> statement-breakpoint
ALTER TABLE "byline_admin_refresh_tokens" ADD CONSTRAINT "byline_admin_refresh_tokens_sid_byline_admin_login_sessions_id_fk" FOREIGN KEY ("sid") REFERENCES "public"."byline_admin_login_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_refresh_tokens_sid" ON "byline_admin_refresh_tokens" USING btree ("sid");