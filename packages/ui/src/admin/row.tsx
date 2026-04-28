/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'

import cx from 'classnames'

interface RowProps {
  children: ReactNode
  className?: string
}

/**
 * Horizontal flex-row layout for admin form fields.
 *
 * Used by `FormRenderer` when a `CollectionAdminConfig` declares a `rows`
 * primitive. Members are rendered side-by-side above the `sm` breakpoint
 * and stack vertically below it. `flex-1` + `min-w-0` lets two text inputs
 * share the row evenly without overflowing.
 */
export const Row = ({ children, className }: RowProps) => {
  return (
    <div
      className={cx(
        'flex flex-col sm:flex-row gap-4 items-start',
        '[&>*]:flex-1 [&>*]:min-w-0',
        className
      )}
    >
      {children}
    </div>
  )
}
