/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Embedded migrations — the numbered SQL in `migrations/` inlined as strings.
 *
 * Why inline rather than read the `.sql` files at runtime: `migrate()` must be
 * callable from a production server bundle, where Nitro / rollup inline this
 * package into a single file and rewrite `import.meta.url`. Any read of
 * `migrations/*.sql` resolved relative to that URL then points at the bundle
 * directory instead of the package, and `migrate()` ENOENTs at boot. Embedding
 * the SQL into the JS makes the runner bundle-safe everywhere.
 *
 * The `.sql` files remain the DBA-reviewable source of truth and still ship in
 * the package for the by-hand install path (`psql -1 -v ON_ERROR_STOP=1 -f`,
 * every file in order — see the package README) —
 * `migrations-data.test.node.ts` asserts the two never drift.
 */

export interface EmbeddedMigration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: EmbeddedMigration[] = [
  {
    version: 1,
    name: '0001_init.sql',
    sql: `-- @byline/search-postgres — 0001_init
--
-- The disposable full-text search index, owned entirely by this driver. One
-- row per (collection_path, document_id, locale). \`search_vector\` stores
-- parser-safe physical tokens produced by @byline/search-analysis and
-- \`analyzer_fingerprint\` identifies the exact portable analysis pipeline.
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

-- Zone scoping (\`zones @> ARRAY[$zone]\`).
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
`,
  },
  {
    version: 2,
    name: '0002_analyzer_fingerprint.sql',
    sql: `-- @byline/search-postgres — 0002_analyzer_fingerprint
--
-- Repairs installations that applied 0001 before portable lexical analysis
-- landed. Three things were added to 0001 in place after it had shipped —
-- the \`analyzer_fingerprint\` column, a NOT NULL constraint on
-- \`search_vector\`, and the \`byline_search_index_metadata\` table — and the
-- runner records versions, not content, so an installation that had already
-- applied 0001 never received them. The first write to the metadata table
-- then fails with \`relation "byline_search_index_metadata" does not exist\`.
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
`,
  },
]
