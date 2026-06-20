ALTER TABLE "byline_document_relationships" DROP CONSTRAINT "byline_document_relationships_parent_document_id_child_document_id_unique";--> statement-breakpoint
ALTER TABLE "byline_document_relationships" DROP CONSTRAINT "byline_document_relationships_parent_document_id_byline_documents_id_fk";
--> statement-breakpoint
DROP INDEX "idx_document_relationships_parent";--> statement-breakpoint
DROP INDEX "idx_document_relationships_child";--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ALTER COLUMN "parent_document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD COLUMN "order_key" varchar(128) COLLATE "C" NOT NULL;--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD COLUMN "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD CONSTRAINT "byline_document_relationships_parent_document_id_byline_documents_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "public"."byline_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_relationships_parent_order" ON "byline_document_relationships" USING btree ("parent_document_id","order_key");--> statement-breakpoint
ALTER TABLE "byline_document_relationships" ADD CONSTRAINT "uq_document_relationships_child" UNIQUE("child_document_id");