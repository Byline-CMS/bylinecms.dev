CREATE TABLE "byline_counter_groups" (
	"group_name" text PRIMARY KEY NOT NULL,
	"sequence_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
