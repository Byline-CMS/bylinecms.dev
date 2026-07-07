/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useTranslation } from '@byline/i18n/react'
import { Container, Section, Table } from '@byline/ui/react'
import cx from 'classnames'

import styles from './document-history.module.css'

/**
 * One serialised audit-log entry as it reaches the admin UI. Mirrors
 * `@byline/client`'s `AuditLogEntry` but with `occurredAt` as an ISO string —
 * the value crosses the TanStack server-fn boundary through `serialise()`,
 * which turns Dates into strings (docs/06-auth-and-security/02-auditability.md — Workstream 3).
 */
export interface AuditLogEntryView {
  id: string
  documentId: string | null
  collectionId: string | null
  actorId: string | null
  actorRealm: string
  action: string
  field: string | null
  before: unknown
  after: unknown
  occurredAt: string
}

/**
 * The document-history payload attached to the history loader: the page of
 * audit entries plus the admin-side resolved actor labels (`actors`, keyed by
 * actor id — ids absent from the map belong to deleted users; system/tooling
 * rows carry a NULL actorId).
 */
export interface DocumentHistoryData {
  entries: AuditLogEntryView[]
  meta: { total: number; page: number; pageSize: number; totalPages: number }
  actors?: Record<string, { label: string }>
}

/**
 * Maps namespaced audit `action` values to their i18n label keys. Unknown
 * actions fall back to the raw value rather than a missing-key warning.
 */
const ACTION_KEYS: Record<string, string> = {
  'document.path.changed': 'collections.documentHistory.actionPathChanged',
  'document.locales.changed': 'collections.documentHistory.actionLocalesChanged',
  'document.status.changed': 'collections.documentHistory.actionStatusChanged',
  'document.deleted': 'collections.documentHistory.actionDeleted',
}

/** Render an audit before/after value inline: arrays comma-join, nullish → em-dash. */
function formatAuditValue(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

/**
 * Document-grain audit log for a single document (docs/06-auth-and-security/02-auditability.md — Workstream
 * 3, "Document history" tab): a chronological, newest-first list of the
 * non-versioned changes the version stream does not record — path /
 * available-locales writes, in-place status transitions, and the deletion
 * event. No diff viewer; before/after render inline.
 */
export const DocumentHistoryView = ({ data }: { data: DocumentHistoryData }) => {
  const { t } = useTranslation('byline-admin')
  const entries = data?.entries ?? []

  if (entries.length === 0) {
    return (
      <Section>
        <Container>
          <p className={cx('byline-coll-dochistory-empty', styles.empty)}>
            {t('collections.documentHistory.empty')}
          </p>
        </Container>
      </Section>
    )
  }

  return (
    <Section>
      <Container>
        <Table.Container className={cx('byline-coll-dochistory-table-wrap', styles.tableWrap)}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeadingCell scope="col">
                  {t('collections.documentHistory.colWhen')}
                </Table.HeadingCell>
                <Table.HeadingCell scope="col">
                  {t('collections.documentHistory.colAction')}
                </Table.HeadingCell>
                <Table.HeadingCell scope="col">
                  {t('collections.documentHistory.colActor')}
                </Table.HeadingCell>
                <Table.HeadingCell scope="col">
                  {t('collections.documentHistory.colChange')}
                </Table.HeadingCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => {
                const actionKey = ACTION_KEYS[entry.action]
                const actionLabel = actionKey ? t(actionKey) : entry.action
                // System/tooling write (NULL actor or 'system' realm) → the
                // system label; an unresolved id is a deleted user; otherwise
                // the admin-resolved label.
                const actorLabel =
                  entry.actorId == null || entry.actorRealm === 'system'
                    ? t('collections.documentHistory.systemActor')
                    : (data.actors?.[entry.actorId]?.label ??
                      t('collections.history.audit.formerUser'))
                // The deletion event carries no before/after; everything else
                // renders "before → after".
                const hasChange = entry.before != null || entry.after != null
                return (
                  <Table.Row key={entry.id}>
                    <Table.Cell className={cx('byline-coll-dochistory-when', styles.when)}>
                      {new Date(entry.occurredAt).toLocaleString()}
                    </Table.Cell>
                    <Table.Cell>{actionLabel}</Table.Cell>
                    <Table.Cell>{actorLabel}</Table.Cell>
                    <Table.Cell className={cx('byline-coll-dochistory-change', styles.change)}>
                      {hasChange ? (
                        <>
                          <span className={cx('byline-coll-dochistory-before', styles.before)}>
                            {formatAuditValue(entry.before)}
                          </span>
                          <span className={cx('byline-coll-dochistory-arrow', styles.arrow)}>
                            {' → '}
                          </span>
                          <span className={cx('byline-coll-dochistory-after', styles.after)}>
                            {formatAuditValue(entry.after)}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        </Table.Container>
      </Container>
    </Section>
  )
}
