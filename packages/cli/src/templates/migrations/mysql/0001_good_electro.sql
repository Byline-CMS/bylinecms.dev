CREATE TABLE `byline_singleton_documents` (
	`collection_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`document_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	CONSTRAINT `byline_singleton_documents_collection_id` PRIMARY KEY(`collection_id`),
	CONSTRAINT `byline_singleton_documents_document_id_unique` UNIQUE(`document_id`)
);
--> statement-breakpoint
ALTER TABLE `byline_documents` ADD CONSTRAINT `uq_documents_collection_id_id` UNIQUE(`collection_id`,`id`);--> statement-breakpoint
ALTER TABLE `byline_singleton_documents` ADD CONSTRAINT `fk_singleton_documents_document` FOREIGN KEY (`collection_id`,`document_id`) REFERENCES `byline_documents`(`collection_id`,`id`) ON DELETE cascade ON UPDATE no action;