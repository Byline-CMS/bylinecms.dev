// Render the SQL-only cutover for a change-controlled installation. The release
// loader verifies the SQL digest before any bytes are written to stdout.
import { loadStorageSteps } from '../dist/migrations/assets.js'

const [base] = loadStorageSteps()
if (base.version !== 15 || base.name !== 'baseline') throw Error('Unexpected cutover baseline')
const quote = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Error('Unexpected catalog identifier')
  return `'${name}'`
}
const entries = Object.entries(base.relations).flatMap(([kind, names]) =>
  names.map((name) => [name, kind])
)
const names = [
  ...entries.map(([name]) => name),
  'byline_core_migrations',
  'byline_core_migrations_pkey',
]
const types = [...base.relations.r, ...base.relations.v, 'byline_core_migrations'].flatMap(
  (name) => [name, `_${name}`]
)
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
SELECT pg_catalog.set_config('byline.expected_database', :'byline_target', true);
DO $preflight$
BEGIN
  IF current_database() <> current_setting('byline.expected_database')
     OR current_setting('server_version_num')::int / 10000 NOT BETWEEN 15 AND 18
     OR current_setting('transaction_read_only')::boolean OR pg_my_temp_schema() <> 0
     OR current_schema() IS DISTINCT FROM 'public'
     OR replace(current_setting('search_path'),' ','') NOT IN ('public','"$user",public')
     OR NOT has_schema_privilege('public','USAGE') OR NOT has_schema_privilege('public','CREATE')
     OR NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname='pgcrypto') THEN
    RAISE EXCEPTION 'Verify target database, supported server, search_path, pgcrypto and migration-role grants';
  END IF;
END $preflight$;
SET LOCAL search_path TO public, pg_temp;
SET LOCAL lock_timeout TO '10s';
SELECT pg_catalog.pg_advisory_xact_lock(1682231442);
DO $inventory$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace
             AND relname IN (${names.map(quote).join(',')}))
     OR EXISTS (SELECT FROM pg_catalog.pg_type WHERE typnamespace='public'::regnamespace
             AND typname IN (${types.map(quote).join(',')})) THEN
    RAISE EXCEPTION 'Reserved Byline relation or type is occupied. Run byline storage status.';
  END IF;
END $inventory$;
${base.sql}
DO $postcheck$
BEGIN
  IF EXISTS (SELECT FROM (VALUES ${entries.map(([name, kind]) => `(${quote(name)},${quote(kind)})`).join(',')}) AS expected(name,kind)
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=expected.name
    WHERE c.relkind::text IS DISTINCT FROM expected.kind) THEN
    RAISE EXCEPTION 'Baseline catalog verification failed';
  END IF;
END $postcheck$;
COMMIT;
`)
