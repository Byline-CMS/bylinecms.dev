/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'

import type { ColumnDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Container,
  IconButton,
  LoaderRing,
  PlusIcon,
  Search,
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

export const ListView = ({
  data,
  columns,
  workflowStatuses,
}: {
  data: AnyCollectionSchemaTypes['ListType']
  columns: ColumnDefinition[]
  workflowStatuses?: WorkflowStatus[]
}) => {
  const navigate = useNavigate()
  const uiLocale = useLocale()
  const location = useRouterState({ select: (s) => s.location })

  const handleOnSearch = (query: string): void => {
    if (query != null && query.length > 0) {
      const params = structuredClone(location.search)
      delete params.page
      params.query = query
      navigate({
        to: '/{-$lng}/admin/collections/$collection',
        params: { ...lngParam(uiLocale), collection: data.included.collection.path },
        search: params,
      })
    }
  }

  const handleOnClear = (): void => {
    const params = structuredClone(location.search)
    delete params.page
    delete params.query
    navigate({
      to: '/{-$lng}/admin/collections/$collection',
      params: { ...lngParam(uiLocale), collection: data.included.collection.path },
      search: params,
    })
  }

  const handleOnStatusFilter = (value: string | null): void => {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    if (value === '_all') {
      delete params.status
    } else {
      params.status = value
    }
    navigate({
      to: '/{-$lng}/admin/collections/$collection',
      params: { ...lngParam(uiLocale), collection: data.included.collection.path },
      search: params,
    })
  }

  function handleOnPageSizeChange(value: string | null): void {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = Number.parseInt(value, 10)
    navigate({
      to: '/{-$lng}/admin/collections/$collection',
      params: { ...lngParam(uiLocale), collection: data.included.collection.path },
      search: params,
    })
  }

  return (
    <Section>
      <Container>
        <div className="flex items-center gap-3 py-[2px]">
          <h1 className="!m-0 pb-[2px]">{data.included.collection.labels.plural as string}</h1>
          <Stats total={data?.meta.total} />
          <IconButton
            aria-label="Create New"
            render={
              <Link
                to="/{-$lng}/admin/collections/$collection/create"
                params={{ ...lngParam(uiLocale), collection: data.included.collection.path }}
              />
            }
          >
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>
        <div className="options flex flex-col gap-2 sm:flex-row items-start sm:items-center mt-3 mb-3">
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder="Search"
            className="mr-auto w-full max-w-[350px]"
          />

          {workflowStatuses && workflowStatuses.length > 0 && (
            <Select<string>
              id="status_filter"
              name="status_filter"
              size="sm"
              value={(location.search as { status?: string }).status ?? '_all'}
              items={[
                { value: '_all', label: 'All' },
                ...workflowStatuses.map((ws) => ({ value: ws.name, label: ws.label ?? ws.name })),
              ]}
              onValueChange={handleOnStatusFilter}
            />
          )}

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
              {data?.documents?.map((document) => {
                return (
                  <Table.Row key={document.document_id}>
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
                          <Link
                            to="/{-$lng}/admin/collections/$collection/$id"
                            params={{
                              ...lngParam(uiLocale),
                              collection: data.included.collection.path,
                              id: document.document_id,
                            }}
                          >
                            {column.formatter
                              ? renderFormatted(
                                  getColumnValue(document, column.fieldName as string),
                                  document,
                                  column.formatter
                                )
                              : (getColumnValue(document, column.fieldName as string) ?? '------')}
                          </Link>
                        ) : column.formatter ? (
                          renderFormatted(
                            getColumnValue(document, column.fieldName as string),
                            document,
                            column.formatter
                          )
                        ) : column.fieldName === 'status' && workflowStatuses ? (
                          <span className="inline-flex items-center gap-1">
                            {workflowStatuses.find((s) => s.name === (document as any).status)
                              ?.label ?? String((document as any).status ?? '')}
                            {(document as any).has_published_version === true &&
                              (document as any).status !== 'published' && (
                                <span
                                  title="A published version is live"
                                  className="inline-block w-2 h-2 rounded-full bg-emerald-500"
                                />
                              )}
                          </span>
                        ) : (
                          String(getColumnValue(document, column.fieldName as string) ?? '')
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
  )
}
