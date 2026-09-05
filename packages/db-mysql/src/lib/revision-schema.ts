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
    'Byline document revision schema is incompatible. Fence all writers/workers, upgrade both packages and schema using 0005_document-revisions.sql, and rerun startup validation before reopening traffic.'
  try {
    const columnResult =
      await db.execute(sql`SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
      CASE WHEN DATA_TYPE = 'bigint' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND COLUMN_DEFAULT IS NULL
        AND IS_NULLABLE = CASE WHEN COLUMN_NAME = 'revision' THEN 'NO' ELSE 'YES' END
        AND EXTRA = '' THEN 1 ELSE 0 END AS valid
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((table_name = 'byline_documents' AND column_name = 'revision') OR (table_name = 'byline_document_publish_schedules' AND column_name = 'authorized_revision'))`)
    const checkResult =
      await db.execute(sql`SELECT t.CONSTRAINT_NAME AS name, c.CHECK_CLAUSE AS clause, (t.ENFORCED = 'YES') AS valid
      FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME IN ('byline_documents', 'byline_document_publish_schedules') AND t.CONSTRAINT_TYPE = 'CHECK'`)
    const columns = columnResult[0] as unknown as Column[]
    const checks = checkResult[0] as unknown as Check[]
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
        'check_publish_schedules_suspended_reason',
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
