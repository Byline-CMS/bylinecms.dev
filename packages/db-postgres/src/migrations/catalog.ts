import type { Client } from 'pg'

import cutover from './cutover-catalog.json' with { type: 'json' }

// Run with search_path pinned to pg_catalog. Resolve identities by qualified names,
// never by OID, owner, creation order or the physical position of a table column.
export async function readCutoverCatalog(client: Client, tables: string[]) {
  const { rows } = await client.query<{ key: string; definition: string }>(
    `WITH owned AS (
      SELECT c.* FROM pg_class c WHERE relnamespace='public'::regnamespace AND relname=ANY($1::name[])
    ), entries(key, definition) AS (
      SELECT c.relname || '/relation', concat_ws('|',relkind,relpersistence,relrowsecurity,relforcerowsecurity,relispartition,
        (SELECT amname FROM pg_am WHERE oid=c.relam),array_to_string(reloptions,',')) FROM owned c
      UNION ALL
      SELECT c.relname || '/column/' || a.attname, concat_ws('|',format_type(a.atttypid,a.atttypmod),
        a.attnotnull, a.attgenerated, a.attidentity, a.attcollation::regcollation::text,
        pg_get_expr(d.adbin,d.adrelid)) FROM owned c JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT c.relname || '/constraint/' || conname, concat_ws('|',pg_get_constraintdef(k.oid),convalidated,
        condeferrable,condeferred,connoinherit) FROM owned c JOIN pg_constraint k ON k.conrelid=c.oid WHERE contype<>'n'
      UNION ALL
      SELECT c.relname || '/index/' || i.relname, concat_ws('|',pg_get_indexdef(i.oid),x.indisvalid,x.indisready,
        x.indislive,x.indimmediate) FROM owned c JOIN pg_index x ON x.indrelid=c.oid JOIN pg_class i ON i.oid=x.indexrelid
      UNION ALL
      SELECT c.relname || '/view', pg_get_viewdef(c.oid,false) FROM owned c WHERE relkind='v'
      UNION ALL
      SELECT c.relname || '/unenforced/' || conname,'constraint is not enforced' FROM owned c JOIN pg_constraint k ON k.conrelid=c.oid
       WHERE (to_jsonb(k)->>'conenforced')::boolean IS FALSE
      UNION ALL
      SELECT c.relname || '/disabled-ri/' || k.conname,'referential integrity trigger disabled' FROM owned c
        JOIN pg_trigger t ON t.tgrelid=c.oid JOIN pg_constraint k ON t.tgconstraint=k.oid
        WHERE t.tgisinternal AND t.tgenabled NOT IN ('O','A')
      UNION ALL
      SELECT c.relname || '/trigger/' || tgname, pg_get_triggerdef(t.oid) FROM owned c JOIN pg_trigger t ON tgrelid=c.oid WHERE NOT tgisinternal
      UNION ALL
      SELECT c.relname || '/rule/' || rulename, pg_get_ruledef(r.oid) FROM owned c JOIN pg_rewrite r ON ev_class=c.oid WHERE rulename<>'_RETURN'
      UNION ALL
      SELECT c.relname || '/inheritance', i.inhparent::regclass::text FROM owned c JOIN pg_inherits i ON i.inhrelid=c.oid
      UNION ALL
      SELECT c.relname || '/descendant', i.inhrelid::regclass::text FROM owned c JOIN pg_inherits i ON i.inhparent=c.oid
    ) SELECT key, definition FROM entries ORDER BY key COLLATE "C"`,
    [tables]
  )
  return Object.fromEntries(rows.map(({ key, definition }) => [key, definition])) as Record<
    string,
    string
  >
}

export interface Finding {
  check: string
  observed: string
  remedy: string
}

export function catalogFindings(actual: Record<string, string>): Finding[] {
  // Native 0013 lets PostgreSQL name this FK. The Drizzle baseline supplies
  // its own name. Compare the complete definition, including the target and action.
  const prefix = 'byline_admin_login_sessions/constraint/'
  const nativeKey = `${prefix}byline_admin_login_sessions_admin_user_id_fkey`
  const baselineKey = `${prefix}byline_admin_login_sessions_admin_user_id_byline_admin_users_id`
  if (Object.hasOwn(actual, nativeKey) && !Object.hasOwn(actual, baselineKey)) {
    actual[baselineKey] = actual[nativeKey]!
    delete actual[nativeKey]
  }
  const expected: Record<string, string> = cutover
  const findings: Finding[] = []
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (actual[key] === expected[key]) continue
    findings.push({
      check: key,
      observed: `expected ${expected[key] ?? 'absent'}, observed ${actual[key] ?? 'missing'}`,
      remedy:
        'On a fenced restore, reconcile this object with the target release SQL and inspect again. Restore the matching backup if its history cannot be established.',
    })
  }
  return findings
}
