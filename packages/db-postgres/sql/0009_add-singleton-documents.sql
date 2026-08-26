-- 0009_add-singleton-documents.sql
--
-- Adds the singleton slot -> document mapping that enforces zero-or-one
-- cardinality for `singleton: true` schemas, plus the supporting unique key the
-- mapping's composite ownership foreign key requires.
--
-- Not a table-only change: `byline_documents` has `id` as its sole primary key,
-- so the composite FK needs `UNIQUE (collection_id, id)` added here.

BEGIN;

-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form, so guard on the
-- catalogue to keep the script re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_documents_collection_id_id'
  ) THEN
    ALTER TABLE byline_documents
      ADD CONSTRAINT uq_documents_collection_id_id UNIQUE (collection_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS byline_singleton_documents (
  collection_id uuid PRIMARY KEY,
  document_id   uuid NOT NULL UNIQUE,
  CONSTRAINT fk_singleton_documents_document
    FOREIGN KEY (collection_id, document_id)
    REFERENCES byline_documents (collection_id, id)
    ON DELETE CASCADE
);

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
