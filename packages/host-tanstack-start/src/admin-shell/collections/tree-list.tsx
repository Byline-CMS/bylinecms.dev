/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { renderFormatted, StatusBadge } from '@byline/admin/react'
import type { ColumnDefinition, WorkflowStatus } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Container, IconButton, PlusIcon, Section, Table } from '@byline/ui/react'
import cx from 'classnames'

import { Link } from '../chrome/loose-router.js'
import { TableHeadingCellSortable } from '../chrome/th-sortable.js'
import { formatNumber } from '../chrome/utils.js'
import styles from './tree-list.module.css'
import type { CollectionTreeRow } from '../../server-fns/collections/tree.js'

// biome-ignore lint/suspicious/noExplicitAny: tree rows carry heterogeneous fields
function getColumnValue(row: CollectionTreeRow, fieldName: string): any {
  if (row.fields && fieldName in row.fields) return row.fields[fieldName]
  return (row as Record<string, any>)[fieldName]
}

/**
 * Built-in list view for `tree: true` collections. Renders the documents in
 * tree order — roots first, each followed by its descendants as indented rows —
 * then any *unplaced* documents under a separator. This is the read-and-browse
 * surface; drag-to-reorder / re-parent is a later phase. Sibling order and
 * nesting are edited per-document via the sidebar tree-placement widget.
 */
export const TreeListView = ({
  rows,
  columns,
  workflowStatuses,
  useAsTitle,
  collection,
  collectionLabels,
}: {
  rows: CollectionTreeRow[]
  columns: ColumnDefinition[]
  workflowStatuses?: WorkflowStatus[]
  useAsTitle?: string
  collection: string
  collectionLabels: { singular: string; plural: string }
}) => {
  const { t } = useTranslation('byline-admin')

  const placed = rows.filter((r) => !r.unplaced)
  const unplaced = rows.filter((r) => r.unplaced)

  const renderCell = (row: CollectionTreeRow, column: ColumnDefinition) => {
    const fieldName = column.fieldName as string
    const isTitle = useAsTitle != null && fieldName === useAsTitle

    if (isTitle) {
      const value = column.formatter
        ? renderFormatted(getColumnValue(row, fieldName), row, column.formatter)
        : (getColumnValue(row, fieldName) ?? row.path ?? '------')
      return (
        <span
          className={cx('byline-tree-list-title', styles.titleCell)}
          style={{ paddingInlineStart: `${row.depth * 1.4}rem` }}
        >
          {row.depth > 0 && (
            <span aria-hidden="true" className={cx('byline-tree-list-branch', styles.branch)}>
              └─
            </span>
          )}
          <Link
            to={'/admin/collections/$collection/$id' as never}
            params={{ collection, id: row.id }}
          >
            {value}
          </Link>
        </span>
      )
    }
    if (column.formatter) {
      return renderFormatted(getColumnValue(row, fieldName), row, column.formatter)
    }
    if (fieldName === 'status' && workflowStatuses) {
      return <StatusBadge status={row.status} workflowStatuses={workflowStatuses} />
    }
    return String(getColumnValue(row, fieldName) ?? '')
  }

  const renderRow = (row: CollectionTreeRow) => (
    <Table.Row key={row.id}>
      {columns.map((column) => (
        <Table.Cell
          key={String(column.fieldName)}
          className={cx({
            [styles.cellRight]: column.align === 'right',
            [styles.cellCenter]: column.align === 'center',
          })}
        >
          {renderCell(row, column)}
        </Table.Cell>
      ))}
    </Table.Row>
  )

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
          <Table>
            <Table.Header>
              <Table.Row>
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
              {placed.map(renderRow)}
              {unplaced.length > 0 && (
                <Table.Row className={cx('byline-tree-list-group', styles.groupRow)}>
                  <Table.Cell className={styles.groupCell}>
                    {t('treeListView.unplacedHeading')}
                  </Table.Cell>
                  {columns.slice(1).map((column) => (
                    <Table.Cell key={String(column.fieldName)} />
                  ))}
                </Table.Row>
              )}
              {unplaced.map(renderRow)}
            </Table.Body>
          </Table>
        </Table.Container>
      </Container>
    </Section>
  )
}
