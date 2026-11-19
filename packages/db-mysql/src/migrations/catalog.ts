import { escapeId, type RowDataPacket } from 'mysql2'
import type { Connection } from 'mysql2/promise'

export const journal = 'byline_core_migrations'
export const createJournal = `CREATE TABLE byline_core_migrations (
  version INT UNSIGNED NOT NULL PRIMARY KEY,
  format_version INT UNSIGNED NOT NULL,
  installation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  origin VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  classification VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  compatible_from INT UNSIGNED NOT NULL,
  stage INT UNSIGNED NOT NULL,
  recorded_by VARCHAR(288) NOT NULL,
  completed_at DATETIME(6) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Byline core migration journal format 1'`

export async function rows(connection: Connection, sql: string, values: unknown[] = []) {
  return (await connection.query<RowDataPacket[]>(sql, values))[0]
}

// MySQL 8.0.16 spells these identical predicates differently. Preserve all
// quoted literals and identifiers, including the case of enum-like strings.
function normalizeExpression(ddl: string) {
  return ddl.replace(
    /'(?:''|\\.|[^'\\])*'|`(?:``|[^`])*`|isnull\((`\w+`)\)|\b(TRUE|FALSE)\b/g,
    (token, column: string | undefined, boolean: string | undefined) =>
      column ? `(${column} is null)` : (boolean?.toLowerCase() ?? token)
  )
}

// Keep column order, but compare named constraints and indexes without relying
// on the order in which InnoDB prints them. AUTO_INCREMENT's next value is data.
function definitionLines(ddl: string, database: string): string[] {
  if (ddl.startsWith('CREATE ALGORITHM=')) {
    return [
      normalizeExpression(ddl)
        .replace(/ DEFINER=`(?:``|[^`])*`@`(?:``|[^`])*` SQL SECURITY /, ' SQL SECURITY ')
        .replaceAll(`${escapeId(database)}.`, ''),
    ]
  }
  let ordinal = 0
  return ddl
    .split('\n')
    .map((line) => {
      let part = normalizeExpression(line.trim().replace(/,$/, ''))
      if (!part.includes(' zerofill')) {
        part = part
          .replace(/^(`\w+` )int\(11\)(?! unsigned)/, '$1int')
          .replace(/^(`\w+` )int\(10\) unsigned/, '$1int unsigned')
          .replace(/^(`\w+` )bigint\(20\)/, '$1bigint')
      }
      if (part.startsWith('`')) return `column ${++ordinal} ${part}`
      if (part.startsWith(') ENGINE=')) return part.replace(/ AUTO_INCREMENT=\d+/, '')
      return part
    })
    .sort()
}

export async function definition(connection: Connection, database: string, name: string) {
  const qualified = `${escapeId(database)}.${escapeId(name)}`
  const [row] = await rows(connection, `SHOW CREATE TABLE ${qualified}`)
  const ddl = row?.['Create Table'] ?? row?.['Create View']
  if (typeof ddl !== 'string')
    throw new Error(`SHOW VIEW or catalog visibility required for ${name}`)
  // Invalid/orphaned definers and inaccessible dependencies invalidate the view.
  if (row?.['Create View']) await connection.query(`SELECT * FROM ${qualified} LIMIT 0`)
  return definitionLines(ddl, database)
}

export function assertDefinition(name: string, expected: string[], actual: string[]) {
  const missing = expected.filter((line) => !actual.includes(line))
  const extra = actual.filter((line) => !expected.includes(line))
  if (missing.length || extra.length)
    throw new Error(
      `${name}: expected ${missing.join(', ') || '(no additional definitions)'}; observed ${extra.join(', ') || '(missing)'}. Fence writers and repair the object or restore the database.`
    )
}
