-- Native JWT login revocation. DDL auto-commits; rerun safely after interruption.
-- Apply with the combined sv/sid release. NULL legacy membership fails closed.
CREATE TABLE IF NOT EXISTS byline_admin_login_sessions (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  admin_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_version int NOT NULL,
  expires_at datetime(6) NOT NULL,
  revoked_at datetime(6),
  CONSTRAINT fk_admin_login_sessions_user FOREIGN KEY (admin_user_id) REFERENCES byline_admin_users(id) ON DELETE CASCADE,
  INDEX idx_admin_login_sessions_user (admin_user_id)
);

SET @byline_login_ddl = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'byline_admin_refresh_tokens' AND column_name = 'sid'), 'SELECT 1', 'ALTER TABLE byline_admin_refresh_tokens ADD COLUMN sid char(36) CHARACTER SET ascii COLLATE ascii_bin');
PREPARE byline_login_statement FROM @byline_login_ddl;
EXECUTE byline_login_statement;
DEALLOCATE PREPARE byline_login_statement;

SET @byline_login_ddl = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'byline_admin_refresh_tokens' AND constraint_name = 'fk_admin_refresh_tokens_sid'), 'SELECT 1', 'ALTER TABLE byline_admin_refresh_tokens ADD CONSTRAINT fk_admin_refresh_tokens_sid FOREIGN KEY (sid) REFERENCES byline_admin_login_sessions(id) ON DELETE CASCADE');
PREPARE byline_login_statement FROM @byline_login_ddl;
EXECUTE byline_login_statement;
DEALLOCATE PREPARE byline_login_statement;

SET @byline_login_ddl = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'byline_admin_refresh_tokens' AND index_name = 'idx_admin_refresh_tokens_sid'), 'SELECT 1', 'CREATE INDEX idx_admin_refresh_tokens_sid ON byline_admin_refresh_tokens(sid)');
PREPARE byline_login_statement FROM @byline_login_ddl;
EXECUTE byline_login_statement;
DEALLOCATE PREPARE byline_login_statement;
