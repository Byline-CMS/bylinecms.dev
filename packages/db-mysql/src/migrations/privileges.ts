import type { Connection } from 'mysql2/promise'

import { rows } from './catalog.js'

// SHOW GRANTS ... USING expands the active role graph. Handle schema wildcard
// grants with the server's own LIKE implementation and partial-revokes mode.
export async function readPrivileges(connection: Connection, database: string) {
  const [session] = await rows(connection, 'SELECT CURRENT_ROLE() AS roles')
  const using = session?.roles === 'NONE' ? '' : String(session?.roles)
  // CURRENT_ROLE returns server-quoted role accounts, even on 8.0.16 where
  // information_schema.ENABLED_ROLES is unavailable. Never interpolate raw names.
  const account = '`(?:``|[^`])*`@`(?:``|[^`])*`'
  if (using && !new RegExp(`^${account}(?:,\\s*${account})*$`).test(using))
    throw Error('Cannot resolve active MySQL role grants')
  const grants = await rows(
    connection,
    `SHOW GRANTS FOR CURRENT_USER${using ? ` USING ${using}` : ''}`
  )
  const scopes = new Map<string, Set<string>>()
  const revoked = new Set<string>()
  for (const grant of grants) {
    const text = String(Object.values(grant)[0])
    const match = text.match(
      /^(GRANT|REVOKE) (.+?) ON (\*|`(?:``|[^`])*`)\.(\*|`(?:``|[^`])*`) (?:TO|FROM) /
    )
    if (!match) continue // Dynamic global privileges and account/role membership have no table scope.
    const [, verb, list, db, object] = match
    const unquote = (s: string) => (s === '*' ? s : s.slice(1, -1).replaceAll('``', '`'))
    if (db !== '*') {
      const pattern = unquote(db!)
      const [r] = await rows(connection, 'SELECT IF(@@partial_revokes,? = ?,? LIKE ?) AS matches', [
        database,
        pattern,
        database,
        pattern,
      ])
      if (!r?.matches) continue
    }
    const key = db === '*' ? 'global' : object === '*' ? 'schema' : `object:${unquote(object!)}`
    const set = verb === 'REVOKE' ? revoked : (scopes.get(key) ?? new Set<string>())
    // Parenthesized column grants do not satisfy table-wide content access.
    // Retain them separately so they still count as journal-writing access.
    for (const item of list!.match(/[^,()]+(?:\([^)]*\))?/g) ?? []) {
      const name = item.trim()
      set.add(name.includes('(') ? `${name.slice(0, name.indexOf('(')).trim()} COLUMN` : name)
    }
    if (verb === 'GRANT') scopes.set(key, set)
  }
  const contains = (set: Set<string> | undefined, priv: string) =>
    Boolean(set?.has(priv) || set?.has('ALL PRIVILEGES'))
  return (object: string | undefined, priv: string) => {
    return (
      contains(scopes.get(`object:${object}`), priv) ||
      contains(scopes.get('schema'), priv) ||
      (contains(scopes.get('global'), priv) && !contains(revoked, priv))
    )
  }
}
