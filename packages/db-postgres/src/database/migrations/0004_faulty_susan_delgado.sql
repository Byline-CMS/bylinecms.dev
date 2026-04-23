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
ALTER TABLE "byline_admin_refresh_tokens" ADD CONSTRAINT "byline_admin_refresh_tokens_admin_user_id_byline_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_byline_admin_refresh_tokens_user" ON "byline_admin_refresh_tokens" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_byline_admin_refresh_tokens_token_hash" ON "byline_admin_refresh_tokens" USING btree ("token_hash");