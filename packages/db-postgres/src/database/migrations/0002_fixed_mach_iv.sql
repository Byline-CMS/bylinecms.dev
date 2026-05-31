CREATE TABLE "byline_document_available_locales" (
	"document_id" uuid NOT NULL,
	"locale" varchar(10) NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "byline_document_available_locales_document_id_locale_pk" PRIMARY KEY("document_id","locale")
);
--> statement-breakpoint
ALTER TABLE "byline_document_available_locales" ADD CONSTRAINT "byline_document_available_locales_document_id_byline_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."byline_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "byline_document_available_locales" ADD CONSTRAINT "byline_document_available_locales_collection_id_byline_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."byline_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_available_locales_document_id" ON "byline_document_available_locales" USING btree ("document_id");