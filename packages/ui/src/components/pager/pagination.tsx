'use client'

// usePagination hook from...
// https://github.com/mui/material-ui/blob/master/packages/mui-material/src/usePagination/usePagination.js
// https://github.com/mui/material-ui/blob/master/LICENSE
/* eslint-disable react/jsx-pascal-case */
import React, { useContext } from 'react'

import cx from 'classnames'

import { Ellipses } from './ellipses.js'
import { FirstButton } from './first-button'
import { usePagination } from './hooks/usePagination'
import { LastButton } from './last-button'
import { NextButton } from './next-button'
import { NumberButton } from './number-button'
import styles from './pagination.module.css'
import { PreviousButton } from './previous-button'
import type { Variant } from './@types'
import type { UsePaginationItem, UsePaginationProps } from './hooks/types/usePagination'

const PAGINATION_NAME = 'Pagination'
const ROOT_NAME = 'Root'
const PAGER_NAME = 'Pager'

export interface PagerContextType {
  variant: Variant
  count: number
  currentPage: number
  hideNextButton?: boolean
  hidePrevButton?: boolean
  items: UsePaginationItem[]
  showFirstButton?: boolean
  showLastButton?: boolean
  eventsEnabled?: boolean
}

export const PagerContext = React.createContext<PagerContextType>({
  variant: 'default',
  count: 1,
  currentPage: 1,
  hideNextButton: false,
  hidePrevButton: false,
  items: [],
  showFirstButton: false,
  showLastButton: false,
  eventsEnabled: false,
})

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Pagination

/**
 * See ./hooks/types/usePagination.ts
 */
export interface PaginationProps extends UsePaginationProps {
  className?: string
  'aria-label'?: string
  variant?: Variant
  children?: React.ReactNode
}

export const Pagination = ({
  children,
  variant = 'default',
  ...rest
}: PaginationProps): React.JSX.Element => {
  const { items } = usePagination({
    ...rest,
  })

  const {
    count,
    page: currentPage,
    hideNextButton,
    hidePrevButton,
    showFirstButton,
    showLastButton,
    onChange,
  } = rest

  const eventsEnabled = onChange != null

  const context = React.useMemo(() => {
    return {
      variant,
      items,
      count,
      currentPage,
      hideNextButton,
      hidePrevButton,
      showFirstButton,
      showLastButton,
      eventsEnabled,
    }
  }, [
    variant,
    items,
    count,
    currentPage,
    hideNextButton,
    hidePrevButton,
    showFirstButton,
    showLastButton,
    eventsEnabled,
  ])

  return <PagerContext value={context}>{children}</PagerContext>
}

Pagination.displayName = PAGINATION_NAME

// Hook helper usePager
export function usePager(): PagerContextType {
  const context = useContext(PagerContext)
  if (context === undefined) {
    throw new Error('usePager must be used within a PagerContext')
  }
  return context
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// First, Previous, Next, Last and Page number buttons

// Define the ref type
export type RefType = HTMLButtonElement | HTMLElement

export type PagerButtonProps = {
  className?: string
  disabled?: boolean
  children?: React.ReactNode
  render?: React.ReactElement
  onClick?: React.ReactEventHandler<Element> | undefined
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Pager container component
export interface PagerProps {
  children?: React.ReactNode
  renderFirst?: (key: string, item: UsePaginationItem) => React.ReactNode
  renderPrevious?: (key: string, item: UsePaginationItem) => React.ReactNode
  renderPageNumber?: (key: string, item: UsePaginationItem) => React.ReactNode
  renderNext?: (key: string, item: UsePaginationItem) => React.ReactNode
  renderLast?: (key: string, item: UsePaginationItem, count: number) => React.ReactNode
  renderEllipses?: (key: string) => React.ReactNode
}

const Pager = ({
  renderFirst = (key, item) => (
    <Pagination.First key={key} disabled={item.disabled} onClick={item.onClick} />
  ),
  renderPrevious = (key, item) => (
    <Pagination.Previous key={key} disabled={item.disabled} onClick={item.onClick} />
  ),
  renderPageNumber = (key, item) => (
    <Pagination.Number
      key={key}
      page={item.page}
      disabled={item.disabled}
      selected={item.selected}
      activeClassName="active"
      onClick={item.onClick}
    />
  ),
  renderNext = (key, item) => (
    <Pagination.Next key={key} page={item.page} disabled={item.disabled} onClick={item.onClick} />
  ),
  renderLast = (key, item, count) => (
    <Pagination.Last key={key} disabled={item.disabled} count={count} onClick={item.onClick} />
  ),
  renderEllipses = (key) => <Ellipses key={key} />,
}: PagerProps): React.JSX.Element => {
  const { items, count } = React.useContext(PagerContext)

  return (
    <>
      {items.map((item, index) => {
        const key = `${item.page}-${index}`
        switch (item.type) {
          case 'start-ellipsis':
          case 'end-ellipsis':
            return renderEllipses(key)
          case 'first':
            return renderFirst(key, item)
          case 'previous':
            return renderPrevious(key, item)
          case 'page':
            return renderPageNumber(key, item)
          case 'next':
            return renderNext(key, item)
          case 'last':
            return renderLast(key, item, count)
          default:
            return null
        }
      })}
    </>
  )
}

Pager.displayName = PAGER_NAME

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Root
export type RootElement = React.ComponentRef<'nav'>
type PrimitiveRootProps = React.ComponentPropsWithoutRef<'nav'>

export interface RootProps extends PrimitiveRootProps {
  className?: string
  itemsClassName?: string
  dataTestId?: string
  ariaLabel?: string
  children?: React.ReactNode
}

const Root = ({
  ref,
  className,
  itemsClassName,
  children,
  ariaLabel,
  dataTestId,
  ...rest
}: RootProps & {
  ref?: React.RefObject<RootElement>
}) => {
  const { variant } = usePager()

  return (
    <nav
      data-testid={dataTestId}
      ref={ref}
      className={cx(
        'infonomic-pagination-root',
        styles['pagination-root'],
        'pagination-root',
        className
      )}
      {...rest}
      aria-label={ariaLabel ?? 'Pager navigation'}
    >
      <ul
        className={cx(
          'infonomic-pagination-items',
          styles['pagination-items'],
          styles[variant],
          itemsClassName
        )}
      >
        {children}
      </ul>
    </nav>
  )
}

Root.displayName = ROOT_NAME

Pagination.Pager = Pager
Pagination.Root = Root
Pagination.First = FirstButton
Pagination.Previous = PreviousButton
Pagination.Number = NumberButton
Pagination.Next = NextButton
Pagination.Last = LastButton
Pagination.Ellipses = Ellipses
