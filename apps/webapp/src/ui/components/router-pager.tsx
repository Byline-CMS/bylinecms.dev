/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useRouterState } from '@tanstack/react-router'

import type { PaginationProps } from '@infonomic/uikit/react'
import {
  ChevronLeftDoubleIcon,
  ChevronLeftIcon,
  ChevronRightDoubleIcon,
  ChevronRightIcon,
  Pagination,
} from '@infonomic/uikit/react'

import { LangLink } from '@/i18n/components/lang-link'
import type { Locale } from '@/i18n/i18n-config'

interface RouterPageProps extends PaginationProps {
  lng?: Locale
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
              <Pagination.First
                render={
                  item.disabled ? (
                    <div />
                  ) : (
                    <LangLink lng={lng} scroll={true} to={location.pathname} search={params} />
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
                    <LangLink lng={lng} scroll={true} to={location.pathname} search={params} />
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
                    <LangLink lng={lng} scroll={true} to={location.pathname} search={params} />
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
                    <LangLink lng={lng} scroll={true} to={location.pathname} search={params} />
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
                    <LangLink lng={lng} scroll={true} to={location.pathname} search={params} />
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
