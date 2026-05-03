'use client'

import type React from 'react'

import { Pagination } from './pagination'
import type { PaginationProps } from './pagination'

/**
 * A convenience event-based pager
 */
export function EventPager(props: PaginationProps): React.JSX.Element {
  const { className, 'aria-label': ariaLabel, ...rest } = props
  return (
    <Pagination {...rest}>
      <Pagination.Root className={className} ariaLabel={ariaLabel}>
        <Pagination.Pager />
      </Pagination.Root>
    </Pagination>
  )
}
