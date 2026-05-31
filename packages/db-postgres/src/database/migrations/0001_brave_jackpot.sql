CREATE TABLE "byline_document_version_locales" (
	"document_version_id" uuid NOT NULL,
	"locale" varchar(10) NOT NULL,
	CONSTRAINT "byline_document_version_locales_document_version_id_locale_pk" PRIMARY KEY("document_version_id","locale")
);
--> statement-breakpoint
ALTER TABLE "byline_document_version_locales" ADD CONSTRAINT "byline_document_version_locales_document_version_id_byline_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."byline_document_versions"("id") ON DELETE cascade ON UPDATE no action;