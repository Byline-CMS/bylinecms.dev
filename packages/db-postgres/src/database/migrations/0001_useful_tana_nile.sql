ALTER TABLE "byline_documents" ADD CONSTRAINT "uq_documents_collection_id_id" UNIQUE("collection_id","id");--> statement-breakpoint
CREATE TABLE "byline_singleton_documents" (
	"collection_id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "byline_singleton_documents_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "byline_singleton_documents" ADD CONSTRAINT "fk_singleton_documents_document" FOREIGN KEY ("collection_id","document_id") REFERENCES "public"."byline_documents"("collection_id","id") ON DELETE cascade ON UPDATE no action;
