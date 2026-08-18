---
title: "Attachment extraction for search"
path: "search-attachment-extraction"
summary: "The planned reusable boundary for extracting text from PDFs and other attachments before published documents enter the search index, and the production experience informing it."
---

# Attachment extraction for search

Companions:
- [Search](./index.md) — the current search architecture consumes text projections and does not extract files itself.
- [Indexing and reindexing](./02-indexing-and-reindexing.md) — completed extraction should trigger the existing published-document synchronization path.
- [Portable multilingual analysis](./05-portable-analysis.md) — extracted plain text enters the same locale-aware analyzer as authored content.
- [File and media uploads](../04-collections/06-file-media-uploads.md) — uploaded files and storage lifecycle are the source inputs for extraction.

Attachment extraction is not part of the shipped Byline search packages, but it is not an
unimplemented idea. A production institutional deployment already extracts and indexes
attachment text through an out-of-process Tika service, persists artifacts in PostgreSQL, and
joins locale-aware text into either Solr or PostgreSQL search without re-extracting during a
reindex. The reusable boundary described on this page is under development: it lets Tika,
Docling, OCR, or a vision-model service produce the same normalized artifact for any capable
search provider.

## Why extraction is separate

Extraction and indexing have different costs and lifecycles.

- Index upserts are cheap and repeatable. A rebuild may run them for every published document.
- PDF parsing, OCR, table reconstruction, and vision-model calls can take seconds or minutes and may incur external cost.
- Extracted markdown or structured blocks can serve RAG and export workflows as well as search.
- A search provider should not need a separate integration for every extractor.

Putting extraction inside `SearchProvider.upsert()` would repeat expensive work on every reindex and create one extractor integration per search engine. Persisting one extraction artifact avoids both problems.

## Planned contract boundary

An extraction provider should accept a stored file reference and return a normalized artifact such as:

```ts
interface ExtractionArtifact {
  plainText: string
  markdown?: string
  language?: string
  metadata?: Record<string, string | number | boolean>
  pages?: Array<{
    page: number
    text: string
    confidence?: number
  }>
}
```

The exact public contract is under development. The boundary itself is stable: extraction produces content; search indexes content.

An implementation is expected to be a TypeScript adapter over an external service:

- Apache Tika Server for broad format support and ordinary text extraction;
- Docling for structured PDFs, tables, and layout-aware output;
- an OCR service for scanned pages; or
- a vision-model endpoint for pages that simpler extractors cannot handle.

The Node.js application should orchestrate these services rather than embedding Python, Java, model runtimes, or GPU dependencies in the search provider.

## Persistence

Store extraction output separately from document EAV rows and search tables. A useful key includes:

- file identity;
- content hash;
- extractor id;
- extractor version; and
- extraction status.

The content hash avoids repeating work for unchanged bytes. The extractor version makes upgrades explicit and supports selective re-extraction.

Do not store generated extraction data as synthetic collection fields. It is derived state with its own failure and rebuild behavior.

## Lifecycle

A likely lifecycle is:

1. an upload or file replacement creates an extraction job;
2. the selected external service extracts the file;
3. the application persists the normalized artifact;
4. if the owning document has a published view, completion calls `indexDocument(documentId)`;
5. `buildSearchDocument()` joins the persisted `plainText` into the appropriate locale projection; and
6. the configured search provider performs its ordinary upsert.

Extraction should not block an editor's publish request when it involves slow OCR or model inference. This work will need a durable job mechanism, retry policy, and observable status.

## Routing between extractors

One installation may compose several providers behind a router:

1. use a fast text-layer extractor for born-digital PDFs and ordinary office files;
2. send scanned pages to OCR;
3. send layout-heavy tables or formulas to a structure-aware service; and
4. reserve vision-model extraction for pages that fail cheaper paths.

Routing signals can include MIME type, text-layer presence, page count, image density, collection policy, language, and a cost budget.

Tika is a practical default where broad format support matters. Docling is appropriate when structured PDF output matters. A vision model is an escalation path, not a requirement for every attachment.

## Joining extracted text into search

The join belongs before `SearchProvider.upsert()`, while Byline assembles or decorates the `SearchDocument`. Extracted plain text should become another configured body contribution, normally at a lower weight than title and authored summary.

The exact extension point is not settled. A core assembly hook keeps all projection inputs together; a provider decorator can prove the boundary downstream without changing core. Either design must preserve the provider contract and keep reindexing independent from extraction.

```text
file -> extraction service -> persisted artifact
                              |
published document -----------+
                              |
                              v
             SearchDocument assembly or decoration
                              |
                              v
                    SearchProvider.upsert()
```

Per-locale indexing needs an explicit rule for attachment language. An artifact may carry a declared or detected language that does not equal the owning document's locale, and unknown-language text still needs a documented home. The upstream contract must define whether artifacts join only a matching locale, fall back to the document or installation default, or contribute to a script-neutral companion projection.

## Under development

The remaining work for the reusable capability:

- public extraction-provider types;
- persistence schema and migration ownership;
- file-to-document ownership queries;
- durable job scheduling, retries, and progress;
- per-collection routing policy;
- re-extraction and backfill commands;
- locale assignment;
- the search-document join; and
- reference adapters for selected external services.

Until this exists, applications may extract files in their own workflow and copy the resulting
plain text into a normal configured body field. The production deployment described above
provides the implementation experience that is expected to inform this reusable boundary.
