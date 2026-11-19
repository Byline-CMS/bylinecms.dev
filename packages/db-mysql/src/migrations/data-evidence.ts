import type { Connection } from 'mysql2/promise'

import { rows } from './catalog.js'
import type { Finding } from './inspect.js'

const checks = [
  {
    check: 'source-locale',
    sql: "SELECT id FROM byline_documents WHERE nullif(trim(source_locale),'') IS NULL",
    remedy:
      'Confirm the historical default content locale, then run the tagged source-locale backfill on a fenced restore.',
  },
  {
    check: 'document-revision',
    sql: 'SELECT id FROM byline_documents WHERE revision IS NULL OR revision NOT BETWEEN 1 AND 9007199254740991',
    remedy:
      'Rehearse native 0005 and restore the document revision from verified history before reopening writers.',
  },
  {
    check: 'schedule-authorization',
    sql: `SELECT document_id AS id FROM byline_document_publish_schedules
      WHERE authorized_revision NOT BETWEEN 1 AND 9007199254740991
       OR (state='armed' AND authorized_revision IS NULL)
       OR (state='needs_reconfirm' AND authorized_revision IS NULL AND NOT (suspended_reason <=> 'upgrade_invalidated') AND NOT (suspended_reason <=> 'content_edited'))`,
    remedy:
      'Fence publishing workers. Rehearse native 0005 to invalidate legacy schedules, or have an authorized editor reconfirm the schedule.',
  },
  {
    check: 'path-liveness',
    sql: `SELECT p.document_id AS id FROM byline_document_paths p
      WHERE EXISTS (SELECT 1 FROM byline_document_versions v WHERE v.document_id=p.document_id)
      AND (p.deleted_at IS NULL) <> EXISTS (SELECT 1 FROM byline_document_versions v WHERE v.document_id=p.document_id AND v.is_deleted=false)`,
    remedy:
      'Rehearse the path liveness backfill and postconditions from native 0001 on a fenced restore.',
  },
  {
    check: 'version-locale-coverage',
    sql: `WITH loc AS (
      ${['text', 'numeric', 'boolean', 'datetime', 'file', 'relation', 'json']
        .map(
          (store) =>
            `SELECT document_version_id, field_path, locale FROM byline_store_${store} WHERE locale <> 'all'`
        )
        .join(' UNION ')}
    ), anchors AS (
      SELECT v.id, coalesce((
        SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(a.change_summary,' → ',1),' ',-1)
        FROM byline_document_versions a WHERE a.document_id=v.document_id AND a.id>v.id
          AND a.event_type='update' AND a.change_summary REGEXP '^re-anchored content source locale [^ ]{1,10} → [^ ]{1,10}$'
        ORDER BY a.id LIMIT 1), d.source_locale) AS source_locale
      FROM byline_document_versions v JOIN byline_documents d ON d.id=v.document_id
    ), covered AS (
      SELECT DISTINCT l.document_version_id,l.locale FROM loc l JOIN anchors a ON a.id=l.document_version_id
      WHERE NOT EXISTS (SELECT 1 FROM loc c WHERE c.document_version_id=a.id AND c.locale=a.source_locale
        AND NOT EXISTS (SELECT 1 FROM loc other WHERE other.document_version_id=a.id AND other.locale=l.locale AND other.field_path=c.field_path))
      UNION ALL SELECT id,'all' FROM anchors a WHERE NOT EXISTS (SELECT 1 FROM loc l WHERE l.document_version_id=a.id)
    ) SELECT c.document_version_id AS id FROM covered c LEFT JOIN byline_document_version_locales v
      ON v.document_version_id=c.document_version_id AND v.locale=c.locale WHERE v.document_version_id IS NULL`,
    remedy:
      'Rehearse the tagged version-locale backfill with the historical anchors. For re-anchored versions, recover missing ledger evidence from a verified backup.',
  },
]

export async function dataFindings(connection: Connection) {
  const findings: Finding[] = []
  for (const { check, sql, remedy } of checks) {
    const found = await rows(connection, `${sql} LIMIT 1`)
    if (found[0]) findings.push({ check, observed: `Failed on ${found[0].id}`, remedy })
  }
  return findings
}
