-- Optional passkey sign-in for admin users (passkeys phase 1).
-- Adds the stable WebAuthn user handle, credential and single-use attempt
-- tables, and the indexes used by bounded authentication maintenance.
-- DDL auto-commits; every step is guarded, so re-run safely after interruption.
SET @byline_passkey_ddl = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'byline_admin_users' AND column_name = 'webauthn_user_handle'), 'SELECT 1', 'ALTER TABLE byline_admin_users ADD COLUMN webauthn_user_handle varbinary(43)');
PREPARE byline_passkey_statement FROM @byline_passkey_ddl;
EXECUTE byline_passkey_statement;
DEALLOCATE PREPARE byline_passkey_statement;
SET @byline_passkey_ddl = IF(EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'byline_admin_users' AND constraint_name = 'byline_admin_users_webauthn_user_handle_unique'), 'SELECT 1', 'ALTER TABLE byline_admin_users ADD CONSTRAINT byline_admin_users_webauthn_user_handle_unique UNIQUE (webauthn_user_handle)');
PREPARE byline_passkey_statement FROM @byline_passkey_ddl;
EXECUTE byline_passkey_statement;
DEALLOCATE PREPARE byline_passkey_statement;

CREATE TABLE IF NOT EXISTS byline_admin_passkey_credentials (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  credential_id varbinary(1366) NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL,
  transports json NOT NULL,
  backup_eligible boolean NOT NULL,
  backed_up boolean NOT NULL,
  name varchar(80) NOT NULL,
  created_at datetime(6) NOT NULL,
  last_used_at datetime(6),
  revoked_at datetime(6),
  CONSTRAINT byline_admin_passkey_credentials_id PRIMARY KEY (id),
  CONSTRAINT byline_admin_passkey_credentials_credential_id_unique UNIQUE (credential_id),
  CONSTRAINT fk_admin_passkeys_user FOREIGN KEY (admin_user_id) REFERENCES byline_admin_users(id) ON DELETE SET NULL,
  INDEX idx_admin_passkeys_user (admin_user_id)
);

CREATE TABLE IF NOT EXISTS byline_admin_passkey_attempts (
  token_hash varbinary(64) NOT NULL,
  purpose varchar(24) NOT NULL,
  challenge varchar(43),
  actor_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  actor_login_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  actor_generation int,
  action varchar(8),
  target_user_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  credential_record_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  proof_credential_id char(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at datetime(6) NOT NULL,
  expires_at datetime(6) NOT NULL,
  consumed_at datetime(6),
  CONSTRAINT byline_admin_passkey_attempts_token_hash PRIMARY KEY (token_hash),
  INDEX idx_admin_passkey_attempts_expiry (expires_at),
  INDEX idx_admin_passkey_attempts_login (actor_login_id),
  INDEX idx_admin_passkey_attempts_consumed (consumed_at)
);

-- Bounded maintenance: expired/revoked login cleanup and legacy refresh purge.
SET @byline_passkey_ddl = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'byline_admin_login_sessions' AND index_name = 'idx_admin_login_sessions_expiry'), 'SELECT 1', 'CREATE INDEX idx_admin_login_sessions_expiry ON byline_admin_login_sessions(expires_at)');
PREPARE byline_passkey_statement FROM @byline_passkey_ddl;
EXECUTE byline_passkey_statement;
DEALLOCATE PREPARE byline_passkey_statement;

SET @byline_passkey_ddl = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'byline_admin_login_sessions' AND index_name = 'idx_admin_login_sessions_revoked'), 'SELECT 1', 'CREATE INDEX idx_admin_login_sessions_revoked ON byline_admin_login_sessions(revoked_at)');
PREPARE byline_passkey_statement FROM @byline_passkey_ddl;
EXECUTE byline_passkey_statement;
DEALLOCATE PREPARE byline_passkey_statement;

SET @byline_passkey_ddl = IF(EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'byline_admin_refresh_tokens' AND index_name = 'idx_admin_refresh_tokens_legacy_expiry'), 'SELECT 1', 'CREATE INDEX idx_admin_refresh_tokens_legacy_expiry ON byline_admin_refresh_tokens(sid, expires_at)');
PREPARE byline_passkey_statement FROM @byline_passkey_ddl;
EXECUTE byline_passkey_statement;
DEALLOCATE PREPARE byline_passkey_statement;
