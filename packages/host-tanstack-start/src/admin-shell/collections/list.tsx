/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useMemo, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import type { ColumnDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { renderFormatted, StatusBadge } from '@byline/ui'
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

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './list.module.css'

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

function Stats({ total }: { total: number }) {
  const [showLoader, _] = useState(false)

  if (showLoader) {
    return (
      <LoaderRing
        className={cx('byline-coll-list-stats-loader', styles.statsLoader)}
        size={24}
        color="#666666"
      />
    )
  }
  return (
    <span className={cx('byline-coll-list-stats', styles.stats)}>
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
      className={cx('byline-coll-list-pad-row', styles.padRow)}
    >
      &nbsp;
    </div>
  ))
}

export const ListView = ({
  data,
  columns,
  workflowStatuses,
  useAsTitle,
}: {
  data: AnyCollectionSchemaTypes['ListType']
  columns: ColumnDefinition[]
  workflowStatuses?: WorkflowStatus[]
  useAsTitle?: string
}) => {
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })

  // Memoized so Base UI's SelectRoot doesn't see a fresh items identity on
  // every render — a non-stable items array combined with a controlled value
  // trips an internal store sync loop (manifests as "Maximum update depth
  // exceeded" inside SelectRoot after navigations that cause a re-render).
  const statusItems = useMemo(
    () => [
      { value: '_all', label: 'All' },
      ...(workflowStatuses?.map((ws) => ({ value: ws.name, label: ws.label ?? ws.name })) ?? []),
    ],
    [workflowStatuses]
  )

  const handleOnSearch = (query: string): void => {
    if (query != null && query.length > 0) {
      const params = structuredClone(location.search)
      delete params.page
      params.query = query
      navigate({
        to: '/admin/collections/$collection' as never,
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
      to: '/admin/collections/$collection' as never,
      params: { collection: data.included.collection.path },
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
      to: '/admin/collections/$collection' as never,
      params: { collection: data.included.collection.path },
      search: params,
    })
  }

  function handleOnPageSizeChange(value: string | null): void {
    if (typeof value !== 'string' || value.length === 0) return
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = Number.parseInt(value, 10)
    navigate({
      to: '/admin/collections/$collection' as never,
      params: { collection: data.included.collection.path },
      search: params,
    })
  }

  return (
    <Section>
      <Container>
        <div className={cx('byline-coll-list-head', styles.head)}>
          <h1 className={cx('byline-coll-list-title', styles.title)}>
            {data.included.collection.labels.plural as string}
          </h1>
          <Stats total={data?.meta.total} />
          <IconButton
            aria-label="Create New"
            render={
              <Link
                to={'/admin/collections/$collection/create' as never}
                params={{ collection: data.included.collection.path }}
              />
            }
          >
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>
        <div className={cx('byline-coll-list-options', styles.options)}>
          <Search
            onSearch={handleOnSearch}
            onClear={handleOnClear}
            inputSize="sm"
            placeholder="Search"
            className={cx('byline-coll-list-search', styles.search)}
          />

          {workflowStatuses && workflowStatuses.length > 1 && (
            <Select<string>
              id="status_filter"
              name="status_filter"
              size="sm"
              value={(location.search as { status?: string }).status ?? '_all'}
              items={statusItems}
              onValueChange={handleOnStatusFilter}
            />
          )}

          <RouterPager
            page={data?.meta.page}
            count={data?.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="pagerTop"
            aria-label="Top Pager"
          />
        </div>
        <Table.Container className={cx('byline-coll-list-table-wrap', styles.tableWrap)}>
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
              {data?.docs?.map((document) => {
                return (
                  <Table.Row key={document.id}>
                    {columns.map((column) => (
                      <Table.Cell
                        key={String(column.fieldName)}
                        className={cx({
                          'byline-coll-list-cell-right': column.align === 'right',
                          [styles.cellRight]: column.align === 'right',
                          'byline-coll-list-cell-center': column.align === 'center',
                          [styles.cellCenter]: column.align === 'center',
                        })}
                      >
                        {useAsTitle && column.fieldName === useAsTitle ? (
                          <Link
                            to={'/admin/collections/$collection/$id' as never}
                            params={{
                              collection: data.included.collection.path,
                              id: document.id,
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
                          <StatusBadge
                            status={document.status}
                            workflowStatuses={workflowStatuses}
                            hasPublishedVersion={document.hasPublishedVersion}
                          />
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
          {padRows(6 - (data?.docs?.length ?? 0))}
        </Table.Container>
        <div
          className={cx(
            'byline-coll-list-options byline-coll-list-options-bottom',
            styles.options,
            styles.optionsBottom
          )}
        >
          <Select<string>
            containerClassName={cx('byline-coll-list-page-size', styles.pageSize)}
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
  )
}
