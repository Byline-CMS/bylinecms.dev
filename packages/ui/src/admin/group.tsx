/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ReactNode } from 'react'

import cx from 'classnames'

import styles from './group.module.css'

interface GroupProps {
  /** Optional heading rendered as a `<legend>` above the cluster. */
  label?: string
  children: ReactNode
  className?: string
}

/**
 * Labelled fieldset clustering related fields together.
 *
 * Used by `FormRenderer` when a `CollectionAdminConfig` declares a `groups`
 * primitive. Renders a bordered, padded `<fieldset>` with an optional
 * `<legend>` for the label.
 *
 * Stable override handles: `.byline-admin-group` on the fieldset and
 * `.byline-admin-group-legend` on the legend (alongside the hashed
 * CSS-modules locals).
 */
export const Group = ({ label, children, className }: GroupProps) => {
  return (
    <fieldset className={cx('byline-admin-group', styles.group, className)}>
      {label && <legend className={cx('byline-admin-group-legend', styles.legend)}>{label}</legend>}
      {children}
    </fieldset>
  )
}
