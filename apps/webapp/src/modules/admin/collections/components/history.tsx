/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import type { CollectionAdminConfig, CollectionDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Container,
  IconButton,
  LoaderRing,
  Section,
  Select,
  Table,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { RouterPager } from '@/ui/components/router-pager'
import { TableHeadingCellSortable } from '@/ui/components/th-sortable.tsx'
import { renderFormatted } from '@/ui/fields/column-formatter'
import { formatNumber } from '@/utils/utils.general.ts'
import { i18n } from '~/i18n'
import { ViewMenu } from './view-menu'

/**
 * Resolve a column value from a document, checking `fields` first (user-defined
 * collection fields) then the root (metadata like status, updated_at).
 */
function getColumnValue(document: any, fieldName: string): any {
  if (document.fields && fieldName in document.fields) {
    return document.fields[fieldName]
  }
  return document[fieldName]
}

// Lazy-load DiffModal because react-diff-viewer-continued uses a web worker
// bundle that cannot be resolved by Node during SSR.
const DiffModal = lazy(() => import('./diff-modal').then((m) => ({ default: m.DiffModal })))

/**
 * Safely extract a displayable string from a field value that may be a plain
 * string or a locale-keyed object (when locale='all').
 * Falls back to the content default locale, then the first available value.
 */
function resolveDisplayValue(value: unknown, locale: string | undefined): string {
  if (value == null) return ''
  if (typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, unknown>
    const candidate =
      locale && locale !== 'all'
        ? map[locale]
        : (map[i18n.content.defaultLocale] ?? Object.values(map)[0])
    return candidate != null ? String(candidate) : ''
  }
  return String(value)
}

function Stats({ total }: { total: number }) {
  const [showLoader, _] = useState(false)

  if (showLoader) {
    return <LoaderRing className="mr-auto -mb-[4px]" size={24} color="#666666" />
  }
  return (
    <span
      className={cx(
        'flex items-center justify-center mr-auto h-[28px] min-w-[28px] px-[6px] py-[5px] -mb-[4px]',
        'whitespace-nowrap text-sm leading-0',
        'bg-gray-25 dark:bg-canvas-700 border rounded-md'
      )}
    >
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
      className="h-[32px] border-none"
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
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  data: AnyCollectionSchemaTypes['HistoryType']
  workflowStatuses?: WorkflowStatus[]
  currentDocument?: Record<string, unknown> | null
}) => {
  const { id, collection } = useParams({
    from: '/{-$lng}/(byline)/admin/collections/$collection/$id/history',
  })
  const navigate = useNavigate()
  const uiLocale = useLocale()
  const columns = adminConfig?.columns || []
  const { labels } = collectionDefinition
  const location = useRouterState({ select: (s) => s.location })
  const locale = location.search.locale
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
      to: '/{-$lng}/admin/collections/$collection',
      params: { ...lngParam(uiLocale), collection },
      search: params,
    })
  }

  return (
    <>
      <Section>
        <Container>
          <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between mb-2">
            <h2 className="mb-2 flex items-center gap-2">
              {labels.singular} History <Stats total={data?.meta.total} />
            </h2>
            <ViewMenu
              collection={collection}
              documentId={id}
              activeView="history"
              locale={locale}
            />
          </div>
        </Container>
      </Section>
      <Section>
        <Container>
          <div className="options flex flex-col gap-2 sm:flex-row items-start sm:items-center mt-3 mb-3">
            <RouterPager
              lng="en"
              page={data?.meta.page}
              count={data?.meta.total_pages}
              showFirstButton
              showLastButton
              componentName="pagerTop"
              aria-label="Top Pager"
            />
          </div>
          <Table.Container className="mt-2 mb-3">
            <Table>
              <Table.Header>
                <Table.Row>
                  <th scope="col" className="w-[1%]" />
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
                {data?.documents?.map((document, rowIndex) => {
                  const versionId = (document as any).document_version_id as string | undefined
                  const { total, page, page_size, desc } = data.meta
                  const versionNumber = desc
                    ? total - (page - 1) * page_size - rowIndex
                    : (page - 1) * page_size + rowIndex + 1
                  return (
                    <Table.Row key={versionId ?? document.document_id}>
                      <Table.Cell className="text-left">
                        {versionId && currentDocument ? (
                          <IconButton
                            size="xs"
                            variant="outlined"
                            intent="noeffect"
                            aria-label="Compare this version with the current version"
                            title="Compare with current"
                            className="tabular-nums text-xs font-mono"
                            onClick={() =>
                              setSelectedVersion({
                                versionId,
                                label: new Date(
                                  (document as any).created_at ?? ''
                                ).toLocaleString(),
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
                          className={
                            column.align === 'right'
                              ? 'text-right'
                              : column.align === 'center'
                                ? 'text-center'
                                : ''
                          }
                        >
                          {column.fieldName === 'title' ? (
                            versionId && currentDocument ? (
                              <button
                                type="button"
                                className="text-left underline underline-offset-2 cursor-pointer hover:opacity-75"
                                onClick={() =>
                                  setSelectedVersion({
                                    versionId,
                                    label: new Date(
                                      (document as any).created_at ?? ''
                                    ).toLocaleString(),
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
                                    locale
                                  ) || '------'}
                              </button>
                            ) : (
                              <Link
                                to="/{-$lng}/admin/collections/$collection/$id"
                                params={{
                                  ...lngParam(uiLocale),
                                  collection,
                                  id: document.document_id,
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
                                    locale
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
                            (workflowStatuses.find((s) => s.name === (document as any).status)
                              ?.label ?? String((document as any).status ?? ''))
                          ) : (
                            resolveDisplayValue(getColumnValue(document, column.fieldName as string), locale) || ''
                          )}
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
            {padRows(6 - (data?.documents?.length ?? 0))}
          </Table.Container>
          <div className="options flex flex-col gap-2 sm:flex-row items-start sm:items-center mb-5">
            <Select<string>
              containerClassName="sm:ml-auto"
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
              lng="en"
              page={data?.meta.page}
              count={data?.meta.total_pages}
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
