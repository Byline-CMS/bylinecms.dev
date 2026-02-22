/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'

import type { ColumnDefinition, ColumnFormatter, FormatterProps, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Container,
  IconButton,
  LoaderRing,
  PlusIcon,
  Search,
  Section,
  Select,
  SelectItem,
  Table,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import { RouterPager } from '@/ui/components/router-pager'
import { TableHeadingCellSortable } from '@/ui/components/th-sortable.tsx'
import { formatNumber } from '@/utils/utils.general.ts'

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

/**
 * Type guard: returns true when the formatter is a `{ component }` wrapper
 * rather than a plain function.
 */
function isComponentFormatter<T>(
  fmt: ColumnFormatter<T>
): fmt is { component: (props: FormatterProps<T>) => any } {
  return typeof fmt === 'object' && fmt !== null && 'component' in fmt
}

/**
 * Render a cell value through its column formatter (if any).
 * Handles both plain-function and `{ component }` formatters.
 */
function renderFormatted(value: any, document: any, formatter: ColumnFormatter) {
  if (isComponentFormatter(formatter)) {
    const Component = formatter.component
    return <Component value={value} record={document} />
  }
  return formatter(value, document)
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
  const location = useRouterState({ select: (s) => s.location })

  const handleOnSearch = (query: string): void => {
    if (query != null && query.length > 0) {
      const params = structuredClone(location.search)
      delete params.page
      params.query = query
      navigate({
        to: '/admin/collections/$collection',
        params: { collection: data.included.collection.path },
        search: params,
      })
    }
  }

  const handleOnClear = (): void => {
    const params = structuredClone(location.search)
    delete params.page
    delete params.query
    navigate({
      to: '/admin/collections/$collection',
      params: { collection: data.included.collection.path },
      search: params,
    })
  }

  function handleOnPageSizeChange(value: string): void {
    if (value != null && value.length > 0) {
      const params = structuredClone(location.search)
      delete params.page
      params.page_size = Number.parseInt(value, 10)
      navigate({
        to: '/admin/collections/$collection',
        params: { collection: data.included.collection.path },
        search: params,
      })
    }
  }

  return (
    <Section>
      <Container>
        <div className="flex items-center gap-3 py-[2px]">
          <h1 className="!m-0 pb-[2px]">{data.included.collection.labels.plural as string}</h1>
          <Stats total={data?.meta.total} />
          <IconButton aria-label="Create New" asChild>
            <Link
              to="/admin/collections/$collection/create"
              params={{ collection: data.included.collection.path }}
            >
              <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
            </Link>
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
                            to="/admin/collections/$collection/$id"
                            params={{
                              collection: data.included.collection.path,
                              id: document.document_id,
                            }}
                          >
                            {column.formatter
                              ? renderFormatted((document as any)[column.fieldName], document, column.formatter)
                              : ((document as any)[column.fieldName] ?? '------')}
                          </Link>
                        ) : column.formatter ? (
                          renderFormatted((document as any)[column.fieldName], document, column.formatter)
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
                          String((document as any)[column.fieldName] ?? '')
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
          <Select
            containerClassName="sm:ml-auto"
            id="page_size"
            name="page_size"
            size="sm"
            defaultValue="15"
            onValueChange={handleOnPageSizeChange}
          >
            <SelectItem value="15">15</SelectItem>
            <SelectItem value="30">30</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </Select>
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
