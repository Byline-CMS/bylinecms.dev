CREATE TABLE "byline_recurring_tasks" (
	"name" varchar(255) PRIMARY KEY NOT NULL,
	"interval_ms" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_owner" varchar(255),
	"lease_expires_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_duration_ms" integer,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_status" varchar(32) DEFAULT 'never_run' NOT NULL,
	"last_error" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
