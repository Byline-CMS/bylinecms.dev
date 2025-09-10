/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router'

import type { CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Button,
  Container,
  HistoryIcon,
  IconButton,
  LoaderRing,
  Section,
  Select,
  SelectItem,
  Table,
} from '@byline/uikit/react'
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

export const HistoryView = ({
  collectionDefinition,
  data,
}: {
  collectionDefinition: CollectionDefinition
  data: AnyCollectionSchemaTypes['HistoryType']
}) => {
  const { id, collection } = useParams({ from: '/collections/$collection/$id/history' })
  const navigate = useNavigate()
  const columns = collectionDefinition.columns || []
  const { labels } = collectionDefinition
  const location = useRouterState({ select: (s) => s.location })

  function handleOnPageSizeChange(value: string): void {
    if (value != null && value.length > 0) {
      const params = structuredClone(location.search)
      delete params.page
      params.page_size = Number.parseInt(value, 10)
      navigate({
        to: '/collections/$collection',
        params: { collection },
        search: params,
      })
    }
  }

  return (
    <>
      <Section>
        <Container>
          <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between mb-2">
            <h2 className="mb-2 flex items-center gap-2">
              {labels.singular} History <Stats total={data?.meta.total} />
            </h2>
            <div className="flex items-center gap-2">
              <IconButton
                className="min-w-[24px] min-h-[24px]"
                size="sm"
                variant="text"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id/history',
                    params: { collection, id },
                  })
                }
              >
                <HistoryIcon className="w-4 h-4" />
              </IconButton>
              <Button
                size="sm"
                variant="filled"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id',
                    params: { collection, id },
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outlined"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id/api',
                    params: { collection, id },
                  })
                }
              >
                API
              </Button>
            </div>
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
                              to="/collections/$collection/$id"
                              params={{
                                collection,
                                id: document.document_id,
                              }}
                            >
                              {column.formatter
                                ? column.formatter((document as any)[column.fieldName], document)
                                : ((document as any)[column.fieldName] ?? '------')}
                            </Link>
                          ) : column.formatter ? (
                            column.formatter((document as any)[column.fieldName], document)
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
    </>
  )
}
