/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { renderFormatted, StatusBadge } from '@byline/admin/react'
import type { ColumnDefinition, WorkflowStatus } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import {
  Container,
  GripperVerticalIcon,
  IconButton,
  PlusIcon,
  Section,
  Table,
  useToastManager,
} from '@byline/ui/react'
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
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

import { Link } from '../chrome/loose-router.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './tree-list.module.css'
import { applyProjection, getTreeProjection } from './tree-list-projection.js'
import type { CollectionTreeRow } from '../../server-fns/collections/tree.js'

/** px per depth level — must match `--byline-tree-indent` in the CSS and the
 * unit of the drag offset fed to the projection. */
const INDENT = 24

export type TreeMoveFn = (params: {
  documentId: string
  parentDocumentId: string | null
  beforeDocumentId: string | null
  afterDocumentId: string | null
}) => Promise<unknown>

// biome-ignore lint/suspicious/noExplicitAny: tree rows carry heterogeneous fields
function getColumnValue(row: CollectionTreeRow, fieldName: string): any {
  if (row.fields && fieldName in row.fields) return row.fields[fieldName]
  return (row as Record<string, any>)[fieldName]
}

/**
 * One draggable `<tr>` in the tree. Renders directly (not via `Table.Row`) so it
 * can take dnd-kit's function `ref`. Indentation uses the *projected* depth for
 * the active row mid-drag, so the row visibly shifts level as it is dragged
 * horizontally.
 */
function SortableTreeRow({
  id,
  depth,
  dragging,
  dragHandleLabel,
  children,
}: {
  id: string
  depth: number
  dragging: boolean
  dragHandleLabel: string
  children: React.ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  })
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    position: 'relative',
    zIndex: isDragging ? 10 : 'auto',
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <tr
      ref={setNodeRef}
      className={cx('byline-table-row', { [styles.draggingRow]: dragging })}
      style={style}
    >
      <td className={cx('byline-tree-list-drag-cell', styles.dragCell)}>
        <button
          type="button"
          className={cx('byline-tree-list-drag-handle', styles.dragHandle)}
          aria-label={dragHandleLabel}
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

export const TreeListView = ({
  rows,
  columns,
  workflowStatuses,
  useAsTitle,
  collection,
  collectionLabels,
  onMove,
}: {
  rows: CollectionTreeRow[]
  columns: ColumnDefinition[]
  workflowStatuses?: WorkflowStatus[]
  useAsTitle?: string
  collection: string
  collectionLabels: { singular: string; plural: string }
  /** When provided, the placed tree becomes drag-to-reorder / re-parent. */
  onMove?: TreeMoveFn
}) => {
  const { t } = useTranslation('byline-admin')
  const router = useRouter()
  const toastManager = useToastManager()

  const unplaced = useMemo(() => rows.filter((r) => r.unplaced), [rows])

  // Local mirror of the placed tree so drag can paint optimistically before the
  // server roundtrip; resync from props when fresh loader data arrives and no
  // move is mid-flight (clobbering an in-flight optimistic state flashes the row
  // back). Mirrors the flat-list reorder pattern.
  const [localPlaced, setLocalPlaced] = useState(() => rows.filter((r) => !r.unplaced))
  const [isMoving, setIsMoving] = useState(false)
  useEffect(() => {
    if (!isMoving) setLocalPlaced(rows.filter((r) => !r.unplaced))
  }, [rows, isMoving])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [offsetLeft, setOffsetLeft] = useState(0)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Live projection while dragging — drives the active row's indentation.
  const projection = useMemo(() => {
    if (activeId == null || overId == null) return null
    return getTreeProjection(localPlaced, activeId, overId, offsetLeft, INDENT)
  }, [activeId, overId, offsetLeft, localPlaced])

  const resetDnd = () => {
    setActiveId(null)
    setOverId(null)
    setOffsetLeft(0)
  }

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))
  const handleDragMove = ({ delta }: DragMoveEvent) => setOffsetLeft(delta.x)
  const handleDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    const proj =
      over != null
        ? getTreeProjection(localPlaced, String(active.id), String(over.id), offsetLeft, INDENT)
        : null
    resetDnd()
    if (!onMove || proj == null) return

    const documentId = String(active.id)
    const next = applyProjection(localPlaced, documentId, proj)
    const current = localPlaced
    const unchanged =
      next.map((r) => r.id).join() === current.map((r) => r.id).join() &&
      next.find((r) => r.id === documentId)?.parentId ===
        current.find((r) => r.id === documentId)?.parentId
    if (unchanged) return

    setLocalPlaced(next)
    setIsMoving(true)
    try {
      await onMove({
        documentId,
        parentDocumentId: proj.parentId,
        beforeDocumentId: proj.beforeId,
        afterDocumentId: proj.afterId,
      })
      await router.invalidate()
    } catch {
      setLocalPlaced(current)
      toastManager.add({
        title: t('collections.list.reorderFailedToast'),
        description: t('collections.list.reorderFailedDescription'),
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setIsMoving(false)
    }
  }

  const renderCells = (row: CollectionTreeRow, depth: number) =>
    columns.map((column) => {
      const fieldName = column.fieldName as string
      const isTitle = useAsTitle != null && fieldName === useAsTitle
      return (
        <Table.Cell
          key={fieldName}
          className={cx({
            [styles.cellRight]: column.align === 'right',
            [styles.cellCenter]: column.align === 'center',
          })}
        >
          {isTitle ? (
            <span
              className={cx('byline-tree-list-title', styles.titleCell)}
              style={{ paddingInlineStart: `${depth * INDENT}px` }}
            >
              {depth > 0 && (
                <span aria-hidden="true" className={cx('byline-tree-list-branch', styles.branch)}>
                  └─
                </span>
              )}
              <Link
                to={'/admin/collections/$collection/$id' as never}
                params={{ collection, id: row.id }}
              >
                {column.formatter
                  ? renderFormatted(getColumnValue(row, fieldName), row, column.formatter)
                  : (getColumnValue(row, fieldName) ?? row.path ?? '------')}
              </Link>
            </span>
          ) : column.formatter ? (
            renderFormatted(getColumnValue(row, fieldName), row, column.formatter)
          ) : fieldName === 'status' && workflowStatuses ? (
            <StatusBadge status={row.status} workflowStatuses={workflowStatuses} />
          ) : (
            String(getColumnValue(row, fieldName) ?? '')
          )}
        </Table.Cell>
      )
    })

  const dndEnabled = onMove != null
  const colSpanLead = dndEnabled ? 1 : 0

  return (
    <Section>
      <Container>
        <div className={cx('byline-coll-list-head', styles.head)}>
          <h1 className={cx('byline-coll-list-title', styles.title)}>{collectionLabels.plural}</h1>
          <span className={cx('byline-coll-list-stats', styles.stats)}>
            {formatNumber(rows.length, 0)}
          </span>
          <IconButton
            aria-label={t('collections.list.createAriaLabel')}
            render={
              <Link to={'/admin/collections/$collection/create' as never} params={{ collection }} />
            }
          >
            <PlusIcon height="18px" width="18px" svgClassName="stroke-white" />
          </IconButton>
        </div>

        <Table.Container className={cx('byline-tree-list-table-wrap', styles.tableWrap)}>
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={resetDnd}
          >
            <Table>
              <Table.Header>
                <Table.Row>
                  {dndEnabled && (
                    <th scope="col" className={cx('byline-tree-list-drag-cell', styles.dragCell)} />
                  )}
                  {columns.map((column) => (
                    <TableHeadingCellSortable
                      key={String(column.fieldName)}
                      fieldName={String(column.fieldName)}
                      label={column.label}
                      sortable={false}
                      scope="col"
                      align={column.align}
                      className={column.className}
                    />
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <SortableContext
                  items={localPlaced.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localPlaced.map((row) => {
                    const depth = row.id === activeId && projection ? projection.depth : row.depth
                    return dndEnabled ? (
                      <SortableTreeRow
                        key={row.id}
                        id={row.id}
                        depth={depth}
                        dragging={row.id === activeId}
                        dragHandleLabel={t('collections.list.dragHandleAriaLabel')}
                      >
                        {renderCells(row, depth)}
                      </SortableTreeRow>
                    ) : (
                      <Table.Row key={row.id}>{renderCells(row, row.depth)}</Table.Row>
                    )
                  })}
                </SortableContext>

                {unplaced.length > 0 && (
                  <Table.Row className={cx('byline-tree-list-group', styles.groupRow)}>
                    <Table.Cell className={styles.groupCell} colSpan={colSpanLead + 1}>
                      {t('treeListView.unplacedHeading')}
                    </Table.Cell>
                    {columns.slice(1).map((column) => (
                      <Table.Cell key={String(column.fieldName)} />
                    ))}
                  </Table.Row>
                )}
                {unplaced.map((row) => (
                  <Table.Row key={row.id}>
                    {dndEnabled && <Table.Cell className={styles.dragCell} />}
                    {renderCells(row, 0)}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </DndContext>
        </Table.Container>
      </Container>
    </Section>
  )
}
