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

/** Bundle-safe mirror of the DBA-reviewable numbered SQL files. */
export const MIGRATIONS: EmbeddedMigration[] = [
  {
    version: 1,
    name: '0001_init.sql',
    sql: `-- @byline/analytics-mysql — 0001_init
--
-- Driver-owned raw events, daily salts, bounded daily aggregates, and rollup
-- cursor. The migration runner records this file in
-- byline_analytics_migrations; these tables are independent of the host
-- application's Drizzle migration stream.

CREATE TABLE IF NOT EXISTS byline_analytics_event (
  id             bigint unsigned NOT NULL AUTO_INCREMENT,
  occurred_at    datetime(6)     NOT NULL,
  kind           varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source         varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  path           varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  visitor_hash   char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  referrer_host  varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  country        char(2) CHARACTER SET ascii COLLATE ascii_bin,
  PRIMARY KEY (id),
  KEY byline_analytics_event_occurred_at_idx (occurred_at),
  CONSTRAINT byline_analytics_event_kind_chk CHECK (kind IN ('page', 'download')),
  CONSTRAINT byline_analytics_event_source_chk CHECK (source IN ('beacon', 'redirect', 'cdnlog')),
  CONSTRAINT byline_analytics_event_path_chk CHECK (path <> '__other__'),
  CONSTRAINT byline_analytics_event_hash_chk CHECK (visitor_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT byline_analytics_event_referrer_chk CHECK (
    referrer_host IS NULL OR referrer_host <> '__other__'
  ),
  CONSTRAINT byline_analytics_event_country_chk CHECK (
    country IS NULL OR country REGEXP '^[A-Z]{2}$'
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_salt (
  day   date       NOT NULL,
  salt  binary(32) NOT NULL,
  PRIMARY KEY (day)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_daily_path (
  day       date NOT NULL,
  kind      varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  path      varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  views     bigint unsigned NOT NULL,
  visitors  bigint unsigned NOT NULL,
  PRIMARY KEY (day, kind, path),
  KEY byline_analytics_daily_path_day_idx (day),
  CONSTRAINT byline_analytics_daily_path_kind_chk CHECK (kind IN ('page', 'download'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_daily_site (
  day        date NOT NULL,
  views      bigint unsigned NOT NULL,
  visitors   bigint unsigned NOT NULL,
  downloads  bigint unsigned NOT NULL,
  PRIMARY KEY (day)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_daily_referrer (
  day            date NOT NULL,
  referrer_host  varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  views          bigint unsigned NOT NULL,
  visitors       bigint unsigned NOT NULL,
  PRIMARY KEY (day, referrer_host),
  KEY byline_analytics_daily_referrer_day_idx (day)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_daily_country (
  day       date NOT NULL,
  country   char(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  views     bigint unsigned NOT NULL,
  visitors  bigint unsigned NOT NULL,
  PRIMARY KEY (day, country)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS byline_analytics_rollup_state (
  singleton          tinyint unsigned NOT NULL,
  last_complete_day  date,
  PRIMARY KEY (singleton),
  CONSTRAINT byline_analytics_rollup_singleton_chk CHECK (singleton = 1)
) ENGINE=InnoDB;
`,
  },
]
