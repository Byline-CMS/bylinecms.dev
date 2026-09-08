-- Byline: native account session generations.
-- Stop all old application instances before migration; restart every instance
-- on the new provider. Mixed old/new writers cannot enforce this contract.
-- Existing access JWTs have no sv claim. Existing refresh rows receive -1.
-- Both are rejected by the new provider, requiring a fresh sign-in.
-- Additive and idempotent: rerunning does not invalidate newly issued sessions.
BEGIN;
ALTER TABLE public.byline_admin_users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.byline_admin_refresh_tokens
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT -1;
COMMIT;
