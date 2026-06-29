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
 * the package for the `psql -f migrations/0001_init.sql` install path —
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
-- The full-text search index, owned entirely by this driver. One row per
-- (collection_path, document_id, locale). The \`search_vector\` is a weighted
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

-- Zone scoping (\`zones @> ARRAY[$zone]\`).
CREATE INDEX IF NOT EXISTS byline_search_documents_zones_idx
  ON byline_search_documents USING gin (zones);

-- Facet aggregation / filtering over the jsonb projection.
CREATE INDEX IF NOT EXISTS byline_search_documents_facets_idx
  ON byline_search_documents USING gin (facets jsonb_path_ops);

-- Single-collection scoping + status filtering.
CREATE INDEX IF NOT EXISTS byline_search_documents_collection_idx
  ON byline_search_documents (collection_path, status);
`,
  },
]
