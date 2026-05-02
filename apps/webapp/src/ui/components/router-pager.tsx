/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Link, useRouterState } from '@tanstack/react-router'

import type { PaginationProps } from '@infonomic/uikit/react'
import {
  ChevronLeftDoubleIcon,
  ChevronLeftIcon,
  ChevronRightDoubleIcon,
  ChevronRightIcon,
  Pagination,
} from '@infonomic/uikit/react'

interface RouterPageProps extends PaginationProps {
  smoothScrollToTop?: boolean
}

/**
 * A convenience pager wrapped around uikit's Pagination with `asChild`
 * targets that delegate to TanStack Router's `<Link>`. `asChild` merges
 * the existing button styles into the rendered Link.
 */
export function RouterPager({
  className,
  smoothScrollToTop,
  'aria-label': ariaLabel,
  ...rest
}: RouterPageProps): React.JSX.Element {
  const location = useRouterState({ select: (s) => s.location })

  return (
    <Pagination variant="dashboard" {...rest}>
      <Pagination.Root className={className} ariaLabel={ariaLabel}>
        <Pagination.Pager
          renderFirst={(key, item) => {
            const params = structuredClone(location.search)
            delete params.page
            return (
              <Pagination.First
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <Link
                      resetScroll={smoothScrollToTop !== true}
                      to={location.pathname as never}
                      search={params}
                    />
                  )
                }
                key={key}
                disabled={item.disabled}
              >
                <ChevronLeftDoubleIcon />
              </Pagination.First>
            )
          }}
          renderPrevious={(key, item) => {
            const params = structuredClone(location.search)
            if (item?.page) {
              params.page = item.page
            }
            return (
              <Pagination.Previous
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <Link
                      resetScroll={smoothScrollToTop !== true}
                      to={location.pathname as never}
                      search={params}
                    />
                  )
                }
                key={key}
                disabled={item.disabled}
              >
                <ChevronLeftIcon />
              </Pagination.Previous>
            )
          }}
          renderPageNumber={(key, item) => {
            const params = structuredClone(location.search)
            if (item?.page === 1) {
              delete params.page
            } else if (item?.page) {
              params.page = item.page
            }
            return (
              <Pagination.Number
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <Link
                      resetScroll={smoothScrollToTop !== true}
                      to={location.pathname as never}
                      search={params}
                    />
                  )
                }
                key={key}
                page={item.page}
                selected={item.selected}
                disabled={item.disabled}
              >
                {item.page}
              </Pagination.Number>
            )
          }}
          renderNext={(key, item) => {
            const params = structuredClone(location.search)
            if (item?.page) {
              params.page = item.page
            }
            return (
              <Pagination.Next
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <Link
                      resetScroll={smoothScrollToTop !== true}
                      to={location.pathname as never}
                      search={params}
                    />
                  )
                }
                key={key}
                page={item.page}
                disabled={item.disabled}
              >
                <ChevronRightIcon />
              </Pagination.Next>
            )
          }}
          renderLast={(key, item, count) => {
            const params = structuredClone(location.search)
            if (count) {
              params.page = count
            }
            return (
              <Pagination.Last
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <Link
                      resetScroll={smoothScrollToTop !== true}
                      to={location.pathname as never}
                      search={params}
                    />
                  )
                }
                key={key}
                disabled={item.disabled}
                count={count}
              >
                <ChevronRightDoubleIcon />
              </Pagination.Last>
            )
          }}
          renderEllipses={(key) => {
            return <Pagination.Ellipses key={key} />
          }}
        />
      </Pagination.Root>
    </Pagination>
  )
}
