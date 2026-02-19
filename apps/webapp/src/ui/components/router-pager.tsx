'use client'

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
