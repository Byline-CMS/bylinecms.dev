import type * as React from 'react'

import cx from 'classnames'

import styles from './table.module.css'

export type TableProps = React.JSX.IntrinsicElements['table']

function Table({
  ref,
  className,
  children,
  ...rest
}: TableProps & {
  ref?: React.RefObject<HTMLTableElement>
}): React.JSX.Element {
  const classes = cx(styles.table, 'infonomic-table', className)

  return (
    <table ref={ref} className={classes} {...rest}>
      {children}
    </table>
  )
}

export type TableContainerProps = React.JSX.IntrinsicElements['div']

function Container({
  ref,
  className,
  children,
  ...rest
}: TableContainerProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  const classes = cx(styles['table-container'], 'infonomic-table-container', className)
  return (
    <div ref={ref} className={classes} {...rest}>
      <div className={cx('infonomic-table-scroller', styles['table-scroller'])}>{children}</div>
    </div>
  )
}

export type TableBodyProps = React.JSX.IntrinsicElements['tbody']

function Body({
  ref,
  className,
  children,
  ...rest
}: TableBodyProps & {
  ref?: React.RefObject<HTMLTableSectionElement>
}): React.JSX.Element {
  return (
    <tbody ref={ref} className={cx('infonomic-table-body', className)} {...rest}>
      {children}
    </tbody>
  )
}

export type TableHeaderProps = React.JSX.IntrinsicElements['thead']

function Header({
  ref,
  className,
  children,
  ...rest
}: TableHeaderProps & {
  ref?: React.RefObject<HTMLTableSectionElement>
}): React.JSX.Element {
  const classes = cx(styles['table-header'], 'infonomic-table-header', className)

  return (
    <thead ref={ref} className={classes} {...rest}>
      {children}
    </thead>
  )
}

export type TableRowProps = React.JSX.IntrinsicElements['tr']

function Row({
  ref,
  className,
  children,
  ...rest
}: TableRowProps & {
  ref?: React.RefObject<HTMLTableRowElement>
}): React.JSX.Element {
  const classes = cx(styles['table-row'], 'infonomic-table-row', className)

  return (
    <tr ref={ref} className={classes} {...rest}>
      {children}
    </tr>
  )
}

export type TableHeadingCellProps = React.JSX.IntrinsicElements['th']

function HeadingCell({
  ref,
  className,
  children,
  ...rest
}: TableHeadingCellProps & {
  ref?: React.RefObject<HTMLTableCellElement>
}): React.JSX.Element {
  const classes = cx(
    styles['table-heading-cell'],
    'infonomic-table-heading-cell',
    'not-prose',
    className
  )
  return (
    <th ref={ref} className={classes} {...rest}>
      {children}
    </th>
  )
}

export type TableCellProps = React.JSX.IntrinsicElements['td']

function Cell({
  ref,
  className,
  children,
  ...rest
}: TableCellProps & {
  ref?: React.RefObject<HTMLTableCellElement>
}): React.JSX.Element {
  const classes = cx(styles['table-cell'], 'infonomic-table-cell', className)

  return (
    <td ref={ref} className={classes} {...rest}>
      {children}
    </td>
  )
}

export type TableFooterProps = React.JSX.IntrinsicElements['tfoot']

function Footer({
  ref,
  className,
  children,
  ...rest
}: TableFooterProps & {
  ref?: React.RefObject<HTMLTableSectionElement>
}): React.JSX.Element {
  const classes = cx(
    'text-xs text-gray-700 uppercase bg-canvas-100 dark:bg-canvas-700 dark:text-gray-400',
    className
  )

  return (
    <tfoot ref={ref} className={classes} {...rest}>
      {children}
    </tfoot>
  )
}

Table.Container = Container
Table.Body = Body
Table.Header = Header
Table.Row = Row
Table.HeadingCell = HeadingCell
Table.Cell = Cell
Table.Footer = Footer

export { Table }
