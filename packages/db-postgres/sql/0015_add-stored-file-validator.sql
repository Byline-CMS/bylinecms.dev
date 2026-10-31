-- Byline: stored-file content identity — storage validator columns.
-- `file_hash` already exists; this adds the validator of the stored version the
-- hash was computed from. Both columns are written and read as a pair and are
-- NULL when unknown. Existing rows stay NULL until backfilled
-- (byline/scripts/backfill-file-identity.ts).
-- Additive and idempotent: safe to rerun. Creates no tables, so no ownership
-- guard is needed.
BEGIN;
ALTER TABLE public.byline_store_file
  ADD COLUMN IF NOT EXISTS storage_validator_kind varchar(32);
ALTER TABLE public.byline_store_file
  ADD COLUMN IF NOT EXISTS storage_validator_value varchar(1024);
COMMIT;
