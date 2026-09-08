-- Native JWT login revocation. Apply with the combined sv/sid release.
-- Legacy refresh rows retain NULL sid and fail closed; do not infer membership.
BEGIN;
CREATE TABLE IF NOT EXISTS public.byline_admin_login_sessions (
  id uuid PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES public.byline_admin_users(id) ON DELETE CASCADE,
  session_version integer NOT NULL,
  expires_at timestamp(6) with time zone NOT NULL,
  revoked_at timestamp(6) with time zone
);
CREATE INDEX IF NOT EXISTS idx_admin_login_sessions_user ON public.byline_admin_login_sessions(admin_user_id);
ALTER TABLE public.byline_admin_refresh_tokens ADD COLUMN IF NOT EXISTS sid uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.byline_admin_refresh_tokens'::regclass
    AND conname = 'byline_admin_refresh_tokens_sid_byline_admin_login_sessions_id_fk') THEN
    ALTER TABLE public.byline_admin_refresh_tokens ADD CONSTRAINT byline_admin_refresh_tokens_sid_byline_admin_login_sessions_id_fk
      FOREIGN KEY (sid) REFERENCES public.byline_admin_login_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_sid ON public.byline_admin_refresh_tokens(sid);

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
