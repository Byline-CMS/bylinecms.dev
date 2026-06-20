-- =============================================================================
-- Byline: document-tree primitive  —  SCHEMA DDL ONLY
-- =============================================================================
--
-- Reshapes `byline_document_relationships` from the dormant many-to-many edge
-- list into a single-parent ordered adjacency model — the storage backing for
-- `tree: true` collections. Drizzle-independent equivalent of the schema delta
-- in `packages/db-postgres/src/database/schema/index.ts`, for an existing
-- production database that does not run `drizzle:migrate`. See
-- docs/DOCUMENT-TREE.md for the design and invariants.
--
--   psql "$DATABASE_URL" -f packages/db-postgres/sql/0004_document_relationships.sql
--
-- The table is DORMANT and EMPTY today (no code reads or writes it), so this is
-- pure DDL with no data backfill. The reshape:
--   - drop  unique(parent_document_id, child_document_id)  (the pair-unique)
--   - add   unique(child_document_id)                      (single-parent invariant)
--   - make  parent_document_id nullable (NULL = root)
--   - change parent FK onDelete: cascade -> set null       (promote orphans to root)
--   - keep   child FK onDelete: cascade                    (node leaves the tree)
--   - add   order_key varchar(128) COLLATE "C"             (per-parent sibling order)
--   - add   updated_at                                     (structure is now editable)
--   - add   index(parent_document_id, order_key)
--
-- Because the old and new shapes are incompatible (the new order_key is NOT NULL
-- with no sensible backfill value) and the table is empty by contract, the
-- reshape is a drop-and-recreate rather than a column-by-column ALTER. Dropping
-- the table also clears the old shape's auto-named constraints/indexes whatever
-- they were called.
--
-- Idempotent and non-destructive on re-run: the whole reshape is guarded on the
-- absence of the new `order_key` column. If the table has already been reshaped
-- (order_key present), the script is a no-op and will NOT drop a populated tree.
--
-- Safe to run as either the application's DB role OR a superuser: the final step
-- reassigns the table to the database owner (the app role), so the running
-- server can always read/write it. Runs in one transaction (Postgres DDL is
-- transactional), so a failure rolls back cleanly.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'byline_document_relationships'
      AND column_name = 'order_key'
  ) THEN
    RAISE NOTICE 'byline_document_relationships already reshaped (order_key present) — skipping';
    RETURN;
  END IF;

  -- The old shape is empty by contract; drop it (and its constraints/indexes).
  DROP TABLE IF EXISTS "byline_document_relationships";

  -- Single-parent ordered adjacency. References the logical document id.
  -- FKs are load-bearing: child cascade (leave tree), parent set-null (promote).
  CREATE TABLE "byline_document_relationships" (
    "child_document_id" uuid NOT NULL,
    "parent_document_id" uuid,
    "order_key" varchar(128) COLLATE "C" NOT NULL,
    "created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "uq_document_relationships_child" UNIQUE ("child_document_id"),
    CONSTRAINT "byline_document_relationships_child_document_id_byline_documents_id_fk"
      FOREIGN KEY ("child_document_id") REFERENCES "byline_documents" ("id") ON DELETE cascade,
    CONSTRAINT "byline_document_relationships_parent_document_id_byline_documents_id_fk"
      FOREIGN KEY ("parent_document_id") REFERENCES "byline_documents" ("id") ON DELETE set null
  );

  -- Per-parent sibling read, in order — drives the authoring tree and the
  -- read-side flatten.
  CREATE INDEX "idx_document_relationships_parent_order"
    ON "byline_document_relationships" ("parent_document_id", "order_key");
END $$;

-- ---------------------------------------------------------------------------
-- Ownership guard. If this script is run as a superuser (e.g. `postgres`), the
-- recreated table would be owned by that superuser and the application's DB role
-- would get "permission denied". Reassign it to the database owner — which is
-- the app role (CREATE DATABASE ... WITH OWNER <app_role>) — so the table is
-- accessible regardless of who runs the script. Indexes inherit table ownership.
-- No-op when already correctly owned.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'byline_document_relationships'
  ) THEN
    EXECUTE format(
      'ALTER TABLE "byline_document_relationships" OWNER TO %I',
      (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database())
    );
  END IF;
END $$;

COMMIT;
