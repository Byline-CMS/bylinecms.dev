ALTER TABLE "byline_document_paths" ADD COLUMN "deleted_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "byline_document_paths" ADD COLUMN "alive" boolean GENERATED ALWAYS AS (CASE WHEN "deleted_at" IS NULL THEN true ELSE NULL END) STORED;--> statement-breakpoint
-- byline:manual-backfill
-- Drizzle generated the surrounding DDL; preserve this data migration when regenerating.
UPDATE "byline_document_paths" AS "path"
SET "deleted_at" = COALESCE(
	(
		SELECT MAX("version"."updated_at")
		FROM "byline_document_versions" AS "version"
		WHERE "version"."document_id" = "path"."document_id"
	),
	"path"."updated_at",
	"path"."created_at",
	CURRENT_TIMESTAMP
)
WHERE "path"."deleted_at" IS NULL
	AND EXISTS (
		SELECT 1
		FROM "byline_document_versions" AS "version"
		WHERE "version"."document_id" = "path"."document_id"
	)
	AND NOT EXISTS (
		SELECT 1
		FROM "byline_document_versions" AS "live_version"
		WHERE "live_version"."document_id" = "path"."document_id"
			AND "live_version"."is_deleted" = false
	);--> statement-breakpoint
ALTER TABLE "byline_document_paths" DROP CONSTRAINT "idx_document_paths_collection_locale_path";--> statement-breakpoint
ALTER TABLE "byline_document_paths" ADD CONSTRAINT "idx_document_paths_collection_locale_path" UNIQUE("collection_id","locale","path","alive");
