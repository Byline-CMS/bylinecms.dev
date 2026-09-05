import { ERR_DATABASE } from '@byline/core'
import { sql } from 'drizzle-orm'

import type { DBExecutor } from './db-manager.js'

type Column = { table_name: string; column_name: string; valid: unknown }
type Check = { name: string; clause: string; valid: unknown }

// Catalogue renderers add parentheses, casts, charset introducers, and escaped quotes.
// Compare complete normalized expressions, not just constraint names or bound substrings.
function normalize(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/::(?:character varying|bigint|integer|text)(?:\[\])?/g, '')
    .replace(/_utf8mb[34]/g, '')
    .replace(/^check/, '')
    .replace(/[\s()[\]`'"\\]/g, '')
}

export async function assertRevisionSchema(db: DBExecutor): Promise<void> {
  const upgrade =
    'Byline document revision schema is incompatible. Fence all writers/workers, upgrade both packages and schema using 0010_document-revisions.sql, and rerun startup validation before reopening traffic.'
  try {
    const columnResult =
      await db.execute(sql`SELECT table_name AS table_name, column_name AS column_name,
      CASE WHEN data_type = 'bigint' AND column_default IS NULL
        AND is_nullable = CASE WHEN column_name = 'revision' THEN 'NO' ELSE 'YES' END
        AND is_generated = 'NEVER' THEN 1 ELSE 0 END AS valid
      FROM information_schema.columns WHERE table_schema = current_schema() AND ((table_name = 'byline_documents' AND column_name = 'revision') OR (table_name = 'byline_document_publish_schedules' AND column_name = 'authorized_revision'))`)
    const checkResult =
      await db.execute(sql`SELECT conname AS name, pg_get_constraintdef(oid) AS clause, convalidated AS valid
      FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('byline_documents'::regclass, 'byline_document_publish_schedules'::regclass)`)
    const columns = columnResult.rows as unknown as Column[]
    const checks = checkResult.rows as unknown as Check[]
    if (columns.length !== 2 || columns.some((column) => Number(column.valid) !== 1))
      throw new Error('Required BIGINT columns must have the correct nullability and no default.')
    const required: Array<[string, string[]]> = [
      [
        'check_documents_revision',
        [
          'revision BETWEEN 1 AND 9007199254740991',
          'revision >= 1 AND revision <= 9007199254740991',
        ],
      ],
      [
        'check_publish_schedules_authorized_revision',
        [
          'authorized_revision IS NULL OR authorized_revision BETWEEN 1 AND 9007199254740991',
          'authorized_revision IS NULL OR authorized_revision >= 1 AND authorized_revision <= 9007199254740991',
        ],
      ],
      [
        'check_document_publish_schedules_suspended_reason',
        [
          "suspended_reason IS NULL OR suspended_reason IN ('content_edited', 'document_metadata_changed', 'upgrade_invalidated')",
          "suspended_reason IS NULL OR suspended_reason = ANY (ARRAY['content_edited', 'document_metadata_changed', 'upgrade_invalidated'])",
        ],
      ],
    ]
    for (const [name, expressions] of required) {
      const check = checks.find((row) => row.name === name)
      if (
        check == null ||
        Number(check.valid) !== 1 ||
        !expressions.some((expression) => normalize(expression) === normalize(check.clause))
      )
        throw new Error(`Missing or incompatible enforced check: ${name}`)
    }
  } catch (cause) {
    throw ERR_DATABASE({ message: upgrade, cause })
  }
}
