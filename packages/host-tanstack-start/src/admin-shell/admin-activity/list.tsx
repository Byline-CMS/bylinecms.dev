'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useRouterState } from '@tanstack/react-router'

import { getClientConfig } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, Container, Section, Select, Table } from '@byline/ui/react'
import cx from 'classnames'

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import styles from './list.module.css'
import type { SystemActivityResponse } from '../../server-fns/admin-activity/index.js'

/**
 * Namespaced audit `action` → i18n label key. Covers the version-stream's
 * synthesised content-save actions (`document.created` / `document.updated`)
 * as well as the audit-log actions surfaced on the per-document history tab.
 * Unknown actions fall back to the raw value rather than a missing-key warning.
 */
const ACTION_KEYS: Record<string, string> = {
  'document.created': 'activity.actions.created',
  'document.updated': 'activity.actions.updated',
  'document.path.changed': 'activity.actions.pathChanged',
  'document.locales.changed': 'activity.actions.localesChanged',
  'document.status.changed': 'activity.actions.statusChanged',
  'document.deleted': 'activity.actions.deleted',
}

/** The selectable action types, in display order. `_all` clears the filter. */
const ACTION_FILTER_VALUES = [
  'document.created',
  'document.updated',
  'document.status.changed',
  'document.path.changed',
  'document.locales.changed',
  'document.deleted',
] as const

/** Render an audit before/after value inline: arrays comma-join, nullish → em-dash. */
function formatAuditValue(value: unknown): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

/**
 * The system-wide activity report (docs/AUDIT.md — Workstream 4): a paged,
 * filterable feed over the union of the version stream (content saves) and the
 * audit log (status / path / locale changes, deletions, and future admin-realm
 * events). Read-only; gated by `admin.activity.read`.
 */
export const ActivitySystemView = ({ data }: { data: SystemActivityResponse }) => {
  const { t } = useTranslation('byline-admin')
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })
  const search = location.search as {
    collection?: string
    action?: string
    page?: number
  }

  const entries = data?.entries ?? []
  const collections = getClientConfig().collections

  // Navigate with the changed filter merged into the URL search; clearing the
  // page so a filter change always lands on page 1. `_all` removes the filter.
  const applyFilter = (key: 'collection' | 'action', value: string) => {
    const params = structuredClone(location.search) as Record<string, unknown>
    params.page = undefined
    if (value === '_all') {
      params[key] = undefined
    } else {
      params[key] = value
    }
    navigate({ to: '/admin/activity' as never, search: params })
  }

  const collectionItems = [
    { value: '_all', label: t('activity.filters.allCollections') },
    ...collections.map((c) => ({
      value: c.path,
      label: (c.labels?.plural as string) ?? c.path,
    })),
  ]

  const actionItems = [
    { value: '_all', label: t('activity.filters.allActions') },
    ...ACTION_FILTER_VALUES.map((a) => ({
      value: a,
      label: ACTION_KEYS[a] ? t(ACTION_KEYS[a]) : a,
    })),
  ]

  const hasFilters = search.collection != null || search.action != null

  return (
    <Section>
      <Container>
        <div className={cx('byline-activity-head', styles.head)}>
          <h1 className={cx('byline-activity-title', styles.title)}>{t('activity.title')}</h1>
        </div>

        <div className={cx('byline-activity-options', styles.options)}>
          <Select<string>
            id="activity_collection_filter"
            name="activity_collection_filter"
            size="sm"
            value={search.collection ?? '_all'}
            items={collectionItems}
            onValueChange={(v) => {
              if (typeof v === 'string') applyFilter('collection', v)
            }}
          />
          <Select<string>
            id="activity_action_filter"
            name="activity_action_filter"
            size="sm"
            value={search.action ?? '_all'}
            items={actionItems}
            onValueChange={(v) => {
              if (typeof v === 'string') applyFilter('action', v)
            }}
          />
          {hasFilters && (
            <Button
              size="sm"
              variant="text"
              onClick={() => navigate({ to: '/admin/activity' as never, search: {} })}
            >
              {t('activity.filters.clear')}
            </Button>
          )}
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="pagerTop"
            aria-label={t('activity.pagerAriaLabel')}
          />
        </div>

        {entries.length === 0 ? (
          <p className={cx('byline-activity-empty', styles.empty)}>{t('activity.empty')}</p>
        ) : (
          <Table.Container className={cx('byline-activity-table-wrap', styles.tableWrap)}>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeadingCell scope="col">{t('activity.columns.when')}</Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('activity.columns.collection')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">{t('activity.columns.action')}</Table.HeadingCell>
                  <Table.HeadingCell scope="col">{t('activity.columns.actor')}</Table.HeadingCell>
                  <Table.HeadingCell scope="col">{t('activity.columns.change')}</Table.HeadingCell>
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
                      ? t('activity.systemActor')
                      : (data.actors?.[entry.actorId]?.label ?? t('activity.formerUser'))

                  const col = entry.collectionId ? data.collections[entry.collectionId] : undefined
                  const collectionLabel = col?.plural ?? col?.path ?? '—'

                  const hasChange = entry.before != null || entry.after != null

                  return (
                    <Table.Row key={entry.id}>
                      <Table.Cell className={cx('byline-activity-when', styles.when)}>
                        {new Date(entry.occurredAt).toLocaleString()}
                      </Table.Cell>
                      <Table.Cell>
                        {col != null && entry.documentId != null ? (
                          <Link
                            to={'/admin/collections/$collection/$id' as never}
                            params={{ collection: col.path, id: entry.documentId }}
                          >
                            {collectionLabel}
                          </Link>
                        ) : (
                          collectionLabel
                        )}
                      </Table.Cell>
                      <Table.Cell>{actionLabel}</Table.Cell>
                      <Table.Cell>{actorLabel}</Table.Cell>
                      <Table.Cell className={cx('byline-activity-change', styles.change)}>
                        {hasChange ? (
                          <>
                            <span className={cx('byline-activity-before', styles.before)}>
                              {formatAuditValue(entry.before)}
                            </span>
                            <span className={cx('byline-activity-arrow', styles.arrow)}>
                              {' → '}
                            </span>
                            <span className={cx('byline-activity-after', styles.after)}>
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
        )}

        <div className={cx('byline-activity-options', styles.options)}>
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="pagerBottom"
            aria-label={t('activity.pagerAriaLabel')}
          />
        </div>
      </Container>
    </Section>
  )
}
