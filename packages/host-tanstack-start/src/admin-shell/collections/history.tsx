/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { lazy, Suspense, useState } from 'react'
import { useParams, useRouterState } from '@tanstack/react-router'

import type { CollectionAdminConfig, CollectionDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { renderFormatted, StatusBadge } from '@byline/ui'
import { Container, IconButton, Section, Select, Table } from '@infonomic/uikit/react'
import cx from 'classnames'

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './history.module.css'
import { ViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from './view-menu.js'

/**
 * Resolve a column value from a document, checking `fields` first (user-defined
 * collection fields) then the root (metadata like status, updated_at).
 */
// biome-ignore lint/suspicious/noExplicitAny: collection rows are heterogeneous
function getColumnValue(document: any, fieldName: string): any {
  if (document.fields && fieldName in document.fields) {
    return document.fields[fieldName]
  }
  return document[fieldName]
}

// Lazy-load DiffModal because react-diff-viewer-continued uses a web worker
// bundle that cannot be resolved by Node during SSR.
const DiffModal = lazy(() => import('@byline/ui').then((m) => ({ default: m.DiffModal })))

/**
 * Safely extract a displayable string from a field value that may be a plain
 * string or a locale-keyed object (when locale='all').
 * Falls back to the supplied default content locale, then the first available value.
 */
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

function Stats({ total }: { total: number }) {
  return (
    <span className={cx('byline-coll-history-stats', styles.stats)}>
      {formatNumber(total as number, 0)}
    </span>
  )
}

function padRows(value: number) {
  return Array.from({ length: value }).map((_, index) => (
    <div
      key={`empty-row-${
        // biome-ignore lint/suspicious/noArrayIndexKey: we're okay here
        index
      }`}
      className={cx('byline-coll-history-pad-row', styles.padRow)}
    >
      &nbsp;
    </div>
  ))
}

export const HistoryView = ({
  collectionDefinition,
  adminConfig,
  data,
  workflowStatuses,
  currentDocument,
  contentLocales,
  defaultContentLocale,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  data: AnyCollectionSchemaTypes['HistoryType']
  workflowStatuses?: WorkflowStatus[]
  currentDocument?: Record<string, unknown> | null
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
}) => {
  const { id, collection } = useParams({
    from: '/(byline)/admin/collections/$collection/$id/history',
  })
  const navigate = useNavigate()
  const columns = adminConfig?.columns || []
  const { labels } = collectionDefinition
  const location = useRouterState({ select: (s) => s.location })
  const locale = (location.search as { locale?: string }).locale
  const [selectedVersion, setSelectedVersion] = useState<{
    versionId: string
    label: string
  } | null>(null)

  function handleOnPageSizeChange(value: string | null): void {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = Number.parseInt(value, 10)
    navigate({
      to: '/admin/collections/$collection' as never,
      params: { collection },
      search: params,
    })
  }

  return (
    <>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-head', styles.head)}>
            <h2 className={cx('byline-coll-history-title', styles.title)}>
              {labels.singular} History <Stats total={data?.meta.total} />
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
        </Container>
      </Section>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-options', styles.options)}>
            <RouterPager
              page={data?.meta.page}
              count={data?.meta.totalPages}
              showFirstButton
              showLastButton
              componentName="pagerTop"
              aria-label="Top Pager"
            />
          </div>
          <Table.Container className={cx('byline-coll-history-table-wrap', styles.tableWrap)}>
            <Table>
              <Table.Header>
                <Table.Row>
                  <th
                    scope="col"
                    className={cx('byline-coll-history-col-version', styles.colVersion)}
                  />
                  {columns.map((column) => {
                    return (
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
                  })}
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {data?.docs?.map((document, rowIndex) => {
                  const versionId = document.versionId
                  const { total, page, pageSize, desc } = data.meta
                  const versionNumber = desc
                    ? total - (page - 1) * pageSize - rowIndex
                    : (page - 1) * pageSize + rowIndex + 1
                  return (
                    <Table.Row key={versionId ?? document.id}>
                      <Table.Cell
                        className={cx('byline-coll-history-version-cell', styles.versionCell)}
                      >
                        {versionId && currentDocument ? (
                          <IconButton
                            size="xs"
                            variant="outlined"
                            intent="noeffect"
                            aria-label="Compare this version with the current version"
                            title="Compare with current"
                            className={cx(
                              'byline-coll-history-version-button',
                              styles.versionButton
                            )}
                            onClick={() =>
                              setSelectedVersion({
                                versionId,
                                label: new Date(document.createdAt).toLocaleString(),
                              })
                            }
                          >
                            {versionNumber}
                          </IconButton>
                        ) : null}
                      </Table.Cell>
                      {columns.map((column) => (
                        <Table.Cell
                          key={String(column.fieldName)}
                          className={cx({
                            'byline-coll-history-cell-right': column.align === 'right',
                            [styles.cellRight]: column.align === 'right',
                            'byline-coll-history-cell-center': column.align === 'center',
                            [styles.cellCenter]: column.align === 'center',
                          })}
                        >
                          {column.fieldName === 'title' ? (
                            versionId && currentDocument ? (
                              <button
                                type="button"
                                className={cx(
                                  'byline-coll-history-title-button',
                                  styles.titleButton
                                )}
                                onClick={() =>
                                  setSelectedVersion({
                                    versionId,
                                    label: new Date(document.createdAt).toLocaleString(),
                                  })
                                }
                              >
                                {column.formatter
                                  ? renderFormatted(
                                      getColumnValue(document, column.fieldName as string),
                                      document,
                                      column.formatter
                                    )
                                  : resolveDisplayValue(
                                      getColumnValue(document, column.fieldName as string),
                                      locale,
                                      defaultContentLocale
                                    ) || '------'}
                              </button>
                            ) : (
                              <Link
                                to={'/admin/collections/$collection/$id' as never}
                                params={{
                                  collection,
                                  id: document.id,
                                }}
                              >
                                {column.formatter
                                  ? renderFormatted(
                                      getColumnValue(document, column.fieldName as string),
                                      document,
                                      column.formatter
                                    )
                                  : resolveDisplayValue(
                                      getColumnValue(document, column.fieldName as string),
                                      locale,
                                      defaultContentLocale
                                    ) || '------'}
                              </Link>
                            )
                          ) : column.formatter ? (
                            renderFormatted(
                              getColumnValue(document, column.fieldName as string),
                              document,
                              column.formatter
                            )
                          ) : column.fieldName === 'status' && workflowStatuses ? (
                            <StatusBadge
                              status={document.status}
                              workflowStatuses={workflowStatuses}
                            />
                          ) : (
                            resolveDisplayValue(
                              getColumnValue(document, column.fieldName as string),
                              locale,
                              defaultContentLocale
                            ) || ''
                          )}
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
            {padRows(6 - (data?.docs?.length ?? 0))}
          </Table.Container>
          <div
            className={cx(
              'byline-coll-history-options byline-coll-history-options-bottom',
              styles.options,
              styles.optionsBottom
            )}
          >
            <Select<string>
              containerClassName={cx('byline-coll-history-page-size', styles.pageSize)}
              id="page_size"
              name="page_size"
              size="sm"
              defaultValue="15"
              items={[
                { value: '15', label: '15' },
                { value: '30', label: '30' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
              ]}
              onValueChange={handleOnPageSizeChange}
            />
            <RouterPager
              smoothScrollToTop={true}
              page={data?.meta.page}
              count={data?.meta.totalPages}
              showFirstButton
              showLastButton
              componentName="pagerBottom"
              aria-label="Bottom Pager"
            />
          </div>
        </Container>
      </Section>

      {selectedVersion && currentDocument && (
        <Suspense fallback={null}>
          <DiffModal
            isOpen={true}
            onDismiss={() => setSelectedVersion(null)}
            collection={collection}
            documentId={id}
            versionId={selectedVersion.versionId}
            versionLabel={selectedVersion.label}
            currentDocument={currentDocument}
            locale={locale}
          />
        </Suspense>
      )}
    </>
  )
}
