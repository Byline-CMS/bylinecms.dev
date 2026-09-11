-- @byline/search-postgres — 0002_analyzer_fingerprint
--
-- Repairs installations that applied 0001 before portable lexical analysis
-- landed. Three things were added to 0001 in place after it had shipped —
-- the `analyzer_fingerprint` column, a NOT NULL constraint on
-- `search_vector`, and the `byline_search_index_metadata` table — and the
-- runner records versions, not content, so an installation that had already
-- applied 0001 never received them. The first write to the metadata table
-- then fails with `relation "byline_search_index_metadata" does not exist`.
--
-- Idempotent, and a no-op on any installation whose 0001 already carried all
-- three: every statement is conditional, and the deletes match no rows once
-- the columns are NOT NULL.
--
-- Rows written before portable analysis carry no fingerprint and cannot be
-- matched by any current query, so they are deleted rather than given an
-- invented one. The index is disposable by design; run a reindex afterwards
-- to repopulate it.

ALTER TABLE byline_search_documents
  ADD COLUMN IF NOT EXISTS analyzer_fingerprint text;

DELETE FROM byline_search_documents
  WHERE analyzer_fingerprint IS NULL OR search_vector IS NULL;

ALTER TABLE byline_search_documents
  ALTER COLUMN analyzer_fingerprint SET NOT NULL;

ALTER TABLE byline_search_documents
  ALTER COLUMN search_vector SET NOT NULL;

-- One locked row per collection prevents concurrent processes with different
-- analyzer fingerprints from mixing incompatible projections. Collection
-- zones let fingerprint guards retain zone scope without scanning documents.
CREATE TABLE IF NOT EXISTS byline_search_index_metadata (
  collection_path      text        PRIMARY KEY,
  analyzer_fingerprint text        NOT NULL,
  zones                text[]      NOT NULL DEFAULT '{}',
  updated_at           timestamptz NOT NULL DEFAULT now()
);
