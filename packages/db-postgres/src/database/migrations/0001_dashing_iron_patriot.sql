CREATE TABLE "byline_admin_user_preferences" (
	"user_id" uuid NOT NULL,
	"scope" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "byline_admin_user_preferences_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
ALTER TABLE "byline_admin_user_preferences" ADD CONSTRAINT "byline_admin_user_preferences_user_id_byline_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."byline_admin_users"("id") ON DELETE cascade ON UPDATE no action;