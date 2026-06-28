-- @byline/search-postgres — 0001_init
--
-- The full-text search index, owned entirely by this driver. One row per
-- (collection_path, document_id, locale). The `search_vector` is a weighted
-- tsvector assembled from the type-enriched SearchDocument at upsert time
-- (title => A, body fields => A–D by boost, facet terms => C). Facet ids and
-- filterable scalars are kept as jsonb for aggregation / filtering.
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
  search_vector   tsvector,
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
