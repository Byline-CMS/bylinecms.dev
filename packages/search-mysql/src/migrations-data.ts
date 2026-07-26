/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
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
    sql: `-- @byline/search-mysql — 0001_init
--
-- Disposable portable full-text index. One row per
-- (collection_path, document_id, locale). Every searchable logical token is
-- encoded by @byline/search-analysis before MySQL's parser sees it, avoiding
-- language-specific stopword and minimum-token divergence.

CREATE TABLE IF NOT EXISTS byline_search_documents (
  collection_path      varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  document_id          varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  locale               varchar(35)  CHARACTER SET ascii   COLLATE ascii_bin   NOT NULL,
  status               varchar(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  zones                json                                                   NOT NULL,
  title                text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci  NOT NULL,
  path                 text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  body                 longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  search_text          longtext CHARACTER SET ascii COLLATE ascii_bin         NOT NULL,
  search_a             longtext CHARACTER SET ascii COLLATE ascii_bin         NOT NULL,
  search_b             longtext CHARACTER SET ascii COLLATE ascii_bin         NOT NULL,
  search_c             longtext CHARACTER SET ascii COLLATE ascii_bin         NOT NULL,
  search_d             longtext CHARACTER SET ascii COLLATE ascii_bin         NOT NULL,
  analyzer_fingerprint varchar(512) CHARACTER SET ascii COLLATE ascii_bin      NOT NULL,
  facets               json                                                   NOT NULL,
  filters              json                                                   NOT NULL,
  updated_at           datetime(6)                                            NOT NULL,
  PRIMARY KEY (collection_path, document_id, locale),
  KEY byline_search_documents_collection_idx (collection_path, status),
  FULLTEXT KEY byline_search_documents_text_idx (search_text),
  FULLTEXT KEY byline_search_documents_a_idx (search_a),
  FULLTEXT KEY byline_search_documents_b_idx (search_b),
  FULLTEXT KEY byline_search_documents_c_idx (search_c),
  FULLTEXT KEY byline_search_documents_d_idx (search_d)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_search_index_metadata (
  collection_path      varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  analyzer_fingerprint varchar(512) CHARACTER SET ascii COLLATE ascii_bin      NOT NULL,
  zones                json                                                   NOT NULL,
  updated_at           datetime(6)                                            NOT NULL,
  PRIMARY KEY (collection_path)
) ENGINE=InnoDB;
`,
  },
]
