/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'

import cx from 'classnames'

import styles from './row.module.css'

interface RowProps {
  children: ReactNode
  className?: string
}

/**
 * Horizontal flex-row layout for admin form fields.
 *
 * Used by `FormRenderer` when a `CollectionAdminConfig` declares a `rows`
 * primitive. Members are rendered side-by-side above the `sm` breakpoint
 * and stack vertically below it. `flex-1` + `min-width: 0` lets two text
 * inputs share the row evenly without overflowing.
 *
 * The element carries `.byline-admin-row` as a stable global class for
 * host overrides (alongside the hashed CSS-modules local).
 */
export const Row = ({ children, className }: RowProps) => {
  return <div className={cx('byline-admin-row', styles.row, className)}>{children}</div>
}
