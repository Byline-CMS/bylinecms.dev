ALTER TABLE "byline_store_file" ADD COLUMN "storage_validator_kind" varchar(32);--> statement-breakpoint
ALTER TABLE "byline_store_file" ADD COLUMN "storage_validator_value" varchar(1024);