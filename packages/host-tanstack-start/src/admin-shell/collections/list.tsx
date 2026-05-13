/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'

import type { ColumnDefinition, WorkflowStatus } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import {
  Container,
  GripperVerticalIcon,
  IconButton,
  LoaderRing,
  PlusIcon,
  renderFormatted,
  Search,
  Section,
  Select,
  StatusBadge,
  Table,
  useToastManager,
} from '@byline/ui/react'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import cx from 'classnames'

import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import { SortAscendingIcon } from '../chrome/sort-icons.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './list.module.css'

type ReorderFn = (params: {
  documentId: string
  beforeDocumentId: string | null
  afterDocumentId: string | null
}) => Promise<unknown>

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

/**
 * One `<tr>` participating in dnd-kit's vertical-list sort. Renders the row
 * directly (not via `Table.Row`) because the row needs a function `ref`
 * callback for dnd-kit; `Table.Row`'s typed `RefObject` prop wouldn't
 * accept that.
 */
function SortableTableRow({
  id,
  disabled,
  children,
}: {
  id: string
  disabled: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <tr ref={setNodeRef} className="byline-table-row" style={style}>
      <td className={cx('byline-coll-list-drag-cell', styles.dragCell)}>
        <button
          type="button"
          className={cx('byline-coll-list-drag-handle', styles.dragHandle)}
          aria-label={
            disabled ? 'Drag disabled while filters or search are active' : 'Drag to reorder'
          }
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripperVerticalIcon />
        </button>
      </td>
      {children}
    </tr>
  )
}

export const ListView = ({
  data,
  columns,
  workflowStatuses,
  useAsTitle,
  orderable = false,
  onReorder,
}: {
  data: AnyCollectionSchemaTypes['ListType']
  columns: ColumnDefinition[]
  workflowStatuses?: WorkflowStatus[]
  useAsTitle?: string
  /** When true, render a drag handle column and enable drag-to-reorder. */
  orderable?: boolean
  /** Persists a single-row reorder via the host's reorder server fn. */
  onReorder?: ReorderFn
}) => {
  const navigate = useNavigate()
  const router = useRouter()
  const toastManager = useToastManager()
  const location = useRouterState({ select: (s) => s.location })

  // Local mirror of the loader docs so drag-and-drop can paint the new
  // order optimistically before the server roundtrip completes. We resync
  // from `data.docs` whenever fresh loader data arrives (after a
  // `router.invalidate()`), unless a reorder is mid-flight — clobbering
  // an in-flight optimistic state would flash the row back to its old
  // position. See the dnd-kit + admin-roles list pattern for the same
  // ordering invariant.
  const [localDocs, setLocalDocs] = useState(data.docs)
  const [isReordering, setIsReordering] = useState(false)
  useEffect(() => {
    if (!isReordering) {
      setLocalDocs(data.docs)
    }
  }, [data.docs, isReordering])

  // Drag is only meaningful in the canonical view: the default order_key
  // sort, no search, no status filter. Otherwise the visible order isn't
  // the stored order and "drop between A and B" maps onto the wrong
  // neighbour ids.
  const searchParams = location.search as {
    order?: string
    desc?: boolean
    query?: string
    status?: string
  }
  const isCanonicalView =
    !searchParams.order && !searchParams.desc && !searchParams.query && !searchParams.status
  const dragEnabled = orderable && isCanonicalView && !!onReorder

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !onReorder) return
    const oldIndex = localDocs.findIndex((d) => d.id === active.id)
    const newIndex = localDocs.findIndex((d) => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

    const previousDocs = localDocs
    const next = [...localDocs]
    const [moved] = next.splice(oldIndex, 1)
    if (!moved) return
    next.splice(newIndex, 0, moved)
    setLocalDocs(next)
    setIsReordering(true)

    const before = next[newIndex - 1]?.id ?? null
    const after = next[newIndex + 1]?.id ?? null
    try {
      await onReorder({
        documentId: String(active.id),
        beforeDocumentId: before,
        afterDocumentId: after,
      })
      await router.invalidate()
    } catch (_err) {
      setLocalDocs(previousDocs)
      toastManager.add({
        title: 'Could not save the new order',
        description: 'Please try again.',
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setIsReordering(false)
    }
  }

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
          {orderable ? (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={localDocs.map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <th scope="col" className={cx('byline-coll-list-drag-cell', styles.dragCell)}>
                        <button
                          type="button"
                          className={cx(
                            'byline-coll-list-order-header',
                            styles.orderHeader,
                            isCanonicalView && [
                              'byline-coll-list-order-header-active',
                              styles.orderHeaderActive,
                            ]
                          )}
                          onClick={() => {
                            // Clear any non-canonical sort and search-related
                            // state so the visible order matches what drag
                            // operations will mutate. Default sort then falls
                            // back to `order_key asc` server-side.
                            const params = structuredClone(
                              location.search as Record<string, unknown>
                            )
                            delete params.page
                            delete params.order
                            delete params.desc
                            navigate({
                              to: location.pathname as never,
                              search: params,
                            })
                          }}
                          aria-label="Sort by manual order"
                          title="Sort by manual order"
                        >
                          <SortAscendingIcon />
                        </button>
                      </th>
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
                    {localDocs.map((document) => (
                      <SortableTableRow key={document.id} id={document.id} disabled={!dragEnabled}>
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
                                  : (getColumnValue(document, column.fieldName as string) ??
                                    '------')}
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
                      </SortableTableRow>
                    ))}
                  </Table.Body>
                </Table>
              </SortableContext>
            </DndContext>
          ) : (
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
                                : (getColumnValue(document, column.fieldName as string) ??
                                  '------')}
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
          )}
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
