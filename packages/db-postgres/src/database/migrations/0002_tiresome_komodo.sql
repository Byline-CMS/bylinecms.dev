CREATE TABLE "byline_document_paths" (
	"document_id" uuid NOT NULL,
	"locale" varchar(10) NOT NULL,
	"collection_id" uuid NOT NULL,
	"path" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "unique_document_paths_document_locale" UNIQUE("document_id","locale"),
	CONSTRAINT "idx_document_paths_collection_locale_path" UNIQUE("collection_id","locale","path")
);
--> statement-breakpoint
ALTER TABLE "byline_document_paths" ADD CONSTRAINT "byline_document_paths_document_id_byline_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_paths" ADD CONSTRAINT "byline_document_paths_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_paths_document_id" ON "byline_document_paths" USING btree ("document_id");