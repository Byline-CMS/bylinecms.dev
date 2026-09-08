-- Byline: native account session generations — SCHEMA DDL ONLY.
-- Stop every old application instance, apply, then restart on the new provider.
-- MySQL DDL auto-commits; rerun safely if interrupted between the two columns.
-- Missing access sv claims and legacy refresh generation -1 require fresh sign-in.
-- Rerunning preserves the generations of all sessions issued after migration.
SET @byline_session_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'byline_admin_users' AND column_name = 'session_version'),
  'SELECT 1',
  'ALTER TABLE byline_admin_users ADD COLUMN session_version int NOT NULL DEFAULT 0'
);
PREPARE byline_session_statement FROM @byline_session_ddl;
EXECUTE byline_session_statement;
DEALLOCATE PREPARE byline_session_statement;

SET @byline_session_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
    AND table_name = 'byline_admin_refresh_tokens' AND column_name = 'session_version'),
  'SELECT 1',
  'ALTER TABLE byline_admin_refresh_tokens ADD COLUMN session_version int NOT NULL DEFAULT -1'
);
PREPARE byline_session_statement FROM @byline_session_ddl;
EXECUTE byline_session_statement;
DEALLOCATE PREPARE byline_session_statement;
