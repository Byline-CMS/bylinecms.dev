'use client'

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

// import { useSearchParams } from 'next/navigation'

interface RouterPageProps extends PaginationProps {
  lng: string
  smoothScrollToTop?: boolean
}

/**
 * A convenience pager, wrapped around Pagination with
 * example render methods and 'asChild' props. 'asChild' will allow you
 * supply a new child to render while also merging the existing props
 * (including styles) of the default component (First, Previous, PageNumber,
 * Nest, Last buttons etc.)
 */
export function RouterPager({
  className,
  lng,
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
              <Pagination.First asChild key={key} disabled={item.disabled}>
                {item.disabled === true ? (
                  <div>
                    <ChevronLeftDoubleIcon />
                  </div>
                ) : (
                  <Link to={location.pathname} search={params}>
                    <ChevronLeftDoubleIcon />
                  </Link>
                )}
              </Pagination.First>
            )
          }}
          renderPrevious={(key, item) => {
            const params = structuredClone(location.search)
            if (item?.page) {
              params.page = item.page
            }
            return (
              <Pagination.Previous asChild key={key} disabled={item.disabled}>
                {item.disabled === true ? (
                  <div>
                    <ChevronLeftIcon />
                  </div>
                ) : (
                  <Link to={location.pathname} search={params}>
                    <ChevronLeftIcon />
                  </Link>
                )}
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
                asChild
                key={key}
                page={item.page}
                selected={item.selected}
                disabled={item.disabled}
              >
                {item.disabled === true ? (
                  <div>{item.page}</div>
                ) : (
                  <Link to={location.pathname} search={params}>
                    {item.page}
                  </Link>
                )}
              </Pagination.Number>
            )
          }}
          renderNext={(key, item) => {
            const params = structuredClone(location.search)
            if (item?.page) {
              params.page = item.page
            }
            return (
              <Pagination.Next asChild key={key} page={item.page} disabled={item.disabled}>
                {item.disabled === true ? (
                  <div>
                    <ChevronRightIcon />
                  </div>
                ) : (
                  <Link to={location.pathname} search={params}>
                    <ChevronRightIcon />
                  </Link>
                )}
              </Pagination.Next>
            )
          }}
          renderLast={(key, item, count) => {
            const params = structuredClone(location.search)
            if (count) {
              params.page = count
            }
            return (
              <Pagination.Last asChild key={key} disabled={item.disabled} count={count}>
                {item.disabled === true ? (
                  <div>
                    <ChevronRightDoubleIcon />
                  </div>
                ) : (
                  <Link to={location.pathname} search={params}>
                    <ChevronRightDoubleIcon />
                  </Link>
                )}
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
