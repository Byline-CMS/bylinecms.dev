import type { Client } from 'pg'

import type { Finding } from './catalog.js'

const checks = [
  {
    check: 'source-locale',
    sql: "SELECT id FROM public.byline_documents WHERE nullif(btrim(source_locale),'') IS NULL",
    remedy:
      'Confirm the historical default content locale, then run the tagged source-locale backfill on a fenced restore.',
  },
  {
    check: 'document-revision',
    sql: 'SELECT id FROM public.byline_documents WHERE revision IS NULL OR revision NOT BETWEEN 1 AND 9007199254740991',
    remedy:
      'Rehearse native 0010 and restore the document revision from verified history before reopening writers.',
  },
  {
    check: 'schedule-authorization',
    sql: `SELECT document_id AS id FROM public.byline_document_publish_schedules
      WHERE authorized_revision NOT BETWEEN 1 AND 9007199254740991
       OR (state='armed' AND authorized_revision IS NULL)
       OR (state='needs_reconfirm' AND authorized_revision IS NULL AND suspended_reason IS DISTINCT FROM 'upgrade_invalidated'
         AND suspended_reason IS DISTINCT FROM 'content_edited')`,
    remedy:
      'Fence publishing workers. Rehearse native 0010 to invalidate legacy schedules, or have an authorized editor reconfirm the schedule.',
  },
  {
    check: 'path-liveness',
    sql: `SELECT p.document_id AS id FROM public.byline_document_paths p
      WHERE EXISTS (SELECT FROM public.byline_document_versions v WHERE v.document_id=p.document_id)
      AND (p.deleted_at IS NULL) <> EXISTS (SELECT FROM public.byline_document_versions v WHERE v.document_id=p.document_id AND v.is_deleted=false)`,
    remedy:
      'Rehearse the path liveness backfill and postconditions from native 0006 on a fenced restore.',
  },
  {
    check: 'version-locale-coverage',
    sql: `WITH loc AS (
      ${['text', 'numeric', 'boolean', 'datetime', 'file', 'relation', 'json']
        .map(
          (store) =>
            `SELECT document_version_id, field_path, locale FROM public.byline_store_${store} WHERE locale <> 'all'`
        )
        .join(' UNION ')}
    ), anchors AS (
      SELECT v.id, coalesce((
        SELECT (regexp_match(a.change_summary, '^re-anchored content source locale ([^ ]{1,10}) → [^ ]{1,10}$'))[1]
        FROM public.byline_document_versions a WHERE a.document_id=v.document_id AND a.id>v.id
          AND a.event_type='update' AND a.change_summary ~ '^re-anchored content source locale [^ ]{1,10} → [^ ]{1,10}$'
        ORDER BY a.id LIMIT 1), d.source_locale) AS source_locale
      FROM public.byline_document_versions v JOIN public.byline_documents d ON d.id=v.document_id
    ), covering AS (
      SELECT DISTINCT l.document_version_id,l.locale FROM loc l JOIN anchors a ON a.id=l.document_version_id
      WHERE NOT EXISTS (SELECT FROM loc c WHERE c.document_version_id=a.id AND c.locale=a.source_locale
        AND NOT EXISTS (SELECT FROM loc other WHERE other.document_version_id=a.id AND other.locale=l.locale AND other.field_path=c.field_path))
      UNION ALL SELECT id,'all' FROM anchors a WHERE NOT EXISTS (SELECT FROM loc l WHERE l.document_version_id=a.id)
    ) SELECT c.document_version_id AS id FROM covering c LEFT JOIN public.byline_document_version_locales v
      ON v.document_version_id=c.document_version_id AND v.locale=c.locale WHERE v.document_version_id IS NULL`,
    remedy:
      'Rehearse the tagged version-locale backfill with the historical anchors. For re-anchored versions, recover missing ledger evidence from a verified backup.',
  },
]

export async function dataFindings(client: Client) {
  const findings: Finding[] = []
  for (const { check, sql, remedy } of checks) {
    const { rows } = await client.query<{ id: string }>(`${sql} LIMIT 1`)
    if (rows[0]) findings.push({ check, observed: `Failed on ${rows[0].id}`, remedy })
  }
  return findings
}
