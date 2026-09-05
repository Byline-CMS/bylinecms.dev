/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useParams, useRouter, useRouterState } from '@tanstack/react-router'

import { AdminTabs, renderFormatted, StatusBadge } from '@byline/admin/react'
import { useBylineAdminServices } from '@byline/admin/services'
import type { CollectionAdminConfig, MultiCollectionDefinition, WorkflowStatus } from '@byline/core'
import { parseDocumentRevision } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { useTranslation } from '@byline/i18n/react'
import { Button, Container, Section, Table } from '@byline/ui/react'
import cx from 'clsx'

import { getAdminRouteId, getAdminRoutePath } from '../../routes/admin-path.js'
import { restoreDocumentVersion } from '../../server-fns/collections/index.js'
import { Link, useNavigate } from '../chrome/loose-router.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { type DocumentHistoryData, DocumentHistoryView } from './document-history.js'
import styles from './history.module.css'
import {
  HistoryStats,
  VersionHistoryCore,
  type VersionHistoryData,
  type VersionHistoryRowPresentation,
} from './version-history.js'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'

/** Resolve user fields before root document metadata such as status. */
function getColumnValue(document: Record<string, unknown>, fieldName: string): unknown {
  if (document.fields && typeof document.fields === 'object' && fieldName in document.fields) {
    return (document.fields as Record<string, unknown>)[fieldName]
  }
  return document[fieldName]
}

/** Resolve a scalar display value from a per-locale history response. */
function resolveDisplayValue(
  value: unknown,
  locale: string | undefined,
  defaultContentLocale: string
): string {
  if (value == null) return ''
  if (typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, unknown>
    const candidate =
      locale && locale !== 'all'
        ? map[locale]
        : (map[defaultContentLocale] ?? Object.values(map)[0])
    return candidate != null ? String(candidate) : ''
  }
  return String(value)
}

export const HistoryView = ({
  collectionDefinition,
  adminConfig,
  data,
  auditLog,
  workflowStatuses,
  currentDocument,
  contentLocales,
  defaultContentLocale,
}: {
  collectionDefinition: MultiCollectionDefinition
  adminConfig?: CollectionAdminConfig
  data: AnyCollectionSchemaTypes['HistoryType'] & {
    /** Admin-resolved acting-user labels keyed by raw version actor id. */
    actors?: Record<string, { label: string }>
  }
  /** Collection-only document-grain audit log. */
  auditLog?: DocumentHistoryData
  workflowStatuses?: WorkflowStatus[]
  currentDocument?: Record<string, unknown> | null
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { id, collection } = useParams({
    from: getAdminRouteId('collections', '$collection', '$id', 'history') as never,
  }) as { id: string; collection: string }
  const navigate = useNavigate()
  const router = useRouter()
  const { getCollectionDocumentVersion } = useBylineAdminServices()
  const { t } = useTranslation('byline-admin')
  const columns = adminConfig?.columns || []
  const { labels } = collectionDefinition
  // Preserve the collection view's existing identity-column contract: its
  // restore cell sits immediately after the configured `useAsTitle` column.
  // Singleton history supplies a separate fixed projection in its wrapper.
  const titleFieldName = collectionDefinition.useAsTitle
  const hasRestoreColumn =
    titleFieldName != null && columns.some((column) => column.fieldName === titleFieldName)
  const location = useRouterState({ select: (state) => state.location })
  const locale = (location.search as { locale?: string }).locale
  const activeTab =
    (location.search as { tab?: string }).tab === 'document' ? 'document' : 'versions'

  function handleTabChange(name: string): void {
    const params = structuredClone(location.search)
    delete params.page
    if (name === 'document') params.tab = 'document'
    else delete params.tab
    navigate({
      to: getAdminRoutePath('collections', '$collection', '$id', 'history'),
      params: { collection, id },
      search: params,
    })
  }

  function handlePageSizeChange(pageSize: number): void {
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = pageSize
    navigate({
      to: getAdminRoutePath('collections', '$collection', '$id', 'history'),
      params: { collection, id },
      search: params,
    })
  }

  const rowPresentation: VersionHistoryRowPresentation = {
    headers: columns.flatMap((column) => {
      const cell = (
        <TableHeadingCellSortable
          key={String(column.fieldName)}
          fieldName={String(column.fieldName)}
          label={column.label}
          sortable={column.sortable}
          scope="col"
          align={column.align}
          className={column.className}
        />
      )
      return titleFieldName != null && column.fieldName === titleFieldName
        ? [
            cell,
            <th
              key="__restore"
              scope="col"
              className={cx('byline-coll-history-col-restore', styles.colRestore)}
            />,
          ]
        : [cell]
    }),
    auditColSpan: columns.length + (hasRestoreColumn ? 1 : 0),
    renderCells: ({
      document,
      versionId,
      versionNumber,
      currentVersionId,
      restoreStatusLabel,
      openCompare,
      openRestore,
    }) =>
      columns.flatMap((column) => {
        const value = getColumnValue(document, String(column.fieldName))
        const dataCell = (
          <Table.Cell
            key={String(column.fieldName)}
            className={cx({
              'byline-coll-history-cell-right': column.align === 'right',
              [styles.cellRight]: column.align === 'right',
              'byline-coll-history-cell-center': column.align === 'center',
              [styles.cellCenter]: column.align === 'center',
            })}
          >
            {titleFieldName != null && column.fieldName === titleFieldName ? (
              versionId && currentDocument ? (
                <button
                  type="button"
                  className={cx('byline-coll-history-title-button', styles.titleButton)}
                  onClick={openCompare}
                >
                  {column.formatter
                    ? renderFormatted(value, document, column.formatter)
                    : resolveDisplayValue(value, locale, defaultContentLocale) || '------'}
                </button>
              ) : (
                <Link
                  to={getAdminRoutePath('collections', '$collection', '$id')}
                  params={{ collection, id: document.id }}
                >
                  {column.formatter
                    ? renderFormatted(value, document, column.formatter)
                    : resolveDisplayValue(value, locale, defaultContentLocale) || '------'}
                </Link>
              )
            ) : column.formatter ? (
              renderFormatted(value, document, column.formatter)
            ) : column.fieldName === 'status' && workflowStatuses ? (
              <StatusBadge status={document.status} workflowStatuses={workflowStatuses} />
            ) : (
              resolveDisplayValue(value, locale, defaultContentLocale) || ''
            )}
          </Table.Cell>
        )

        return titleFieldName != null && column.fieldName === titleFieldName
          ? [
              dataCell,
              <Table.Cell
                key="__restore"
                className={cx('byline-coll-history-restore-cell', styles.restoreCell)}
              >
                {versionId && versionId !== currentVersionId ? (
                  <Button
                    type="button"
                    variant="outlined"
                    size="xs"
                    intent="noeffect"
                    onClick={openRestore}
                    className={cx('byline-coll-history-restore-button', styles.restoreButton)}
                    title={t('collections.history.restoreButtonTitle', {
                      status: restoreStatusLabel,
                    })}
                  >
                    {t('collections.history.restoreButton')}
                  </Button>
                ) : null}
              </Table.Cell>,
            ]
          : [dataCell]
      }),
  }

  return (
    <>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-head', styles.head)}>
            <h2 className={cx('byline-coll-history-title', styles.title)}>
              {t('collections.history.title', { label: labels.singular })}{' '}
              <HistoryStats
                total={activeTab === 'document' ? (auditLog?.meta.total ?? 0) : data.meta.total}
              />
            </h2>
            <ViewMenu
              collection={collection}
              documentId={id}
              activeView="history"
              locale={locale}
              contentLocales={contentLocales}
              defaultContentLocale={defaultContentLocale}
            />
          </div>
          <AdminTabs
            tabs={[
              { name: 'versions', label: t('collections.history.tabs.versions') },
              { name: 'document', label: t('collections.history.tabs.document') },
            ]}
            activeTab={activeTab}
            onChange={handleTabChange}
            className={cx('byline-coll-history-tabs', styles.tabs)}
          />
        </Container>
      </Section>

      {activeTab === 'document' ? (
        <DocumentHistoryView
          data={
            auditLog ?? { entries: [], meta: { total: 0, page: 1, pageSize: 0, totalPages: 0 } }
          }
        />
      ) : (
        <Section>
          <Container>
            <VersionHistoryCore
              data={data as unknown as VersionHistoryData}
              resourceDefinition={collectionDefinition}
              resourcePath={collection}
              documentId={id}
              currentDocument={currentDocument}
              locale={locale}
              rowPresentation={rowPresentation}
              loadHistoricalVersion={getCollectionDocumentVersion}
              onPageSizeChange={handlePageSizeChange}
              restoreVersion={(versionId) =>
                restoreDocumentVersion({
                  data: {
                    expectedRevision: parseDocumentRevision(currentDocument?.revision),
                    collection,
                    id,
                    versionId,
                  },
                })
              }
              onRestoreComplete={async () => {
                await router.invalidate()
                navigate({
                  to: getAdminRoutePath('collections', '$collection', '$id'),
                  params: { collection, id },
                })
              }}
            />
          </Container>
        </Section>
      )}
    </>
  )
}
