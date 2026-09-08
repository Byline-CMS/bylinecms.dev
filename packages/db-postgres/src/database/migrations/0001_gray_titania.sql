CREATE TABLE "byline_admin_sign_in_rate_limits" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_admin_sign_in_rate_limits_expiry" ON "byline_admin_sign_in_rate_limits" USING btree ("expires_at");