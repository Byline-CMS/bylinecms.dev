-- @byline/search-postgres — 0001_init
--
-- The disposable full-text search index, owned entirely by this driver. One
-- row per (collection_path, document_id, locale). `search_vector` stores
-- parser-safe physical tokens produced by @byline/search-analysis and
-- `analyzer_fingerprint` identifies the exact portable analysis pipeline.
-- Search indexes created with an older schema must be dropped and rebuilt.
--
-- Idempotent (IF NOT EXISTS throughout) so re-applying is safe. The driver's
-- migration runner records applied versions in byline_search_migrations.

CREATE TABLE IF NOT EXISTS byline_search_documents (
  collection_path text        NOT NULL,
  document_id     text        NOT NULL,
  locale          text        NOT NULL,
  status          text        NOT NULL,
  zones           text[]      NOT NULL DEFAULT '{}',
  title           text        NOT NULL DEFAULT '',
  path            text,
  body            text        NOT NULL DEFAULT '',
  search_vector   tsvector    NOT NULL,
  analyzer_fingerprint text   NOT NULL,
  facets          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  filters         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_path, document_id, locale)
);

-- Ranked full-text search.
CREATE INDEX IF NOT EXISTS byline_search_documents_vector_idx
  ON byline_search_documents USING gin (search_vector);

-- Zone scoping (`zones @> ARRAY[$zone]`).
CREATE INDEX IF NOT EXISTS byline_search_documents_zones_idx
  ON byline_search_documents USING gin (zones);

-- Facet aggregation / filtering over the jsonb projection.
CREATE INDEX IF NOT EXISTS byline_search_documents_facets_idx
  ON byline_search_documents USING gin (facets jsonb_path_ops);

-- Single-collection scoping + status filtering.
CREATE INDEX IF NOT EXISTS byline_search_documents_collection_idx
  ON byline_search_documents (collection_path, status);

-- One locked row per collection prevents concurrent processes with different
-- analyzer fingerprints from mixing incompatible projections. Collection
-- zones let fingerprint guards retain zone scope without scanning documents.
CREATE TABLE IF NOT EXISTS byline_search_index_metadata (
  collection_path      text        PRIMARY KEY,
  analyzer_fingerprint text        NOT NULL,
  zones                text[]      NOT NULL DEFAULT '{}',
  updated_at           timestamptz NOT NULL DEFAULT now()
);
