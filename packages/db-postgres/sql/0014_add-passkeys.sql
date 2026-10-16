-- Optional passkey sign-in for admin users (passkeys phase 1).
-- Adds the stable WebAuthn user handle, credential and single-use attempt
-- tables, and the indexes used by bounded authentication maintenance.
-- Idempotent; safe to re-run.
BEGIN;
ALTER TABLE public.byline_admin_users ADD COLUMN IF NOT EXISTS webauthn_user_handle varchar(43) COLLATE "C";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.byline_admin_users'::regclass
    AND conname = 'byline_admin_users_webauthn_user_handle_unique') THEN
    ALTER TABLE public.byline_admin_users ADD CONSTRAINT byline_admin_users_webauthn_user_handle_unique
      UNIQUE (webauthn_user_handle);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.byline_admin_passkey_credentials (
  id uuid PRIMARY KEY NOT NULL,
  admin_user_id uuid,
  credential_id varchar(1366) COLLATE "C" NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL,
  transports jsonb NOT NULL,
  backup_eligible boolean NOT NULL,
  backed_up boolean NOT NULL,
  name varchar(80) NOT NULL,
  created_at timestamp(6) with time zone NOT NULL,
  last_used_at timestamp(6) with time zone,
  revoked_at timestamp(6) with time zone,
  CONSTRAINT byline_admin_passkey_credentials_credential_id_unique UNIQUE (credential_id),
  CONSTRAINT byline_admin_passkey_credentials_admin_user_id_byline_admin_users_id_fk
    FOREIGN KEY (admin_user_id) REFERENCES public.byline_admin_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_passkeys_user ON public.byline_admin_passkey_credentials(admin_user_id);

CREATE TABLE IF NOT EXISTS public.byline_admin_passkey_attempts (
  token_hash varchar(64) COLLATE "C" PRIMARY KEY NOT NULL,
  purpose varchar(24) NOT NULL,
  challenge varchar(43),
  actor_user_id uuid,
  actor_login_id uuid,
  actor_generation integer,
  action varchar(8),
  target_user_id uuid,
  credential_record_id uuid,
  proof_credential_id uuid,
  created_at timestamp(6) with time zone NOT NULL,
  expires_at timestamp(6) with time zone NOT NULL,
  consumed_at timestamp(6) with time zone
);
CREATE INDEX IF NOT EXISTS idx_admin_passkey_attempts_expiry ON public.byline_admin_passkey_attempts(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_passkey_attempts_login ON public.byline_admin_passkey_attempts(actor_login_id);
CREATE INDEX IF NOT EXISTS idx_admin_passkey_attempts_consumed ON public.byline_admin_passkey_attempts(consumed_at);

-- Bounded maintenance: expired/revoked login cleanup and legacy refresh purge.
CREATE INDEX IF NOT EXISTS idx_admin_login_sessions_expiry ON public.byline_admin_login_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_login_sessions_revoked ON public.byline_admin_login_sessions(revoked_at);
CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_legacy_expiry ON public.byline_admin_refresh_tokens(sid, expires_at);

-- ---------------------------------------------------------------------------
-- byline:ownership-guard
--
-- If this script was run by a superuser (e.g. `postgres`) rather than the
-- application's DB role, any object it created is owned by that superuser and
-- the app role gets "permission denied". Reassign every table and sequence in
-- `public` not already owned by the database owner — the app role, per
-- CREATE DATABASE ... WITH OWNER <app_role> — back to it. Indexes inherit
-- table ownership, so they follow automatically. No-op when the app role ran
-- the script (current_user = db owner) or nothing is mis-owned.
--
-- Keep this block identical across every sql/ migration: the ownership-guard
-- contract test asserts its presence in any script that creates a table. See
-- src/database/ownership-guard.test.node.ts.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  db_owner text := (
    SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()
  );
  obj record;
BEGIN
  IF current_user = db_owner THEN
    RETURN;
  END IF;
  FOR obj IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = db_owner)
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', obj.relname, db_owner);
  END LOOP;
END $$;

COMMIT;
