/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import cx from 'classnames'

import styles from './locale-badge.module.css'

export interface LocaleBadgeProps {
  locale: string
}

/**
 * Small inline badge shown next to the label of a field that has
 * `localized: true` in its schema definition. Indicates which locale
 * the editor is currently working in.
 *
 * Stable override handle: `.byline-locale-badge`.
 */
export const LocaleBadge = ({ locale }: LocaleBadgeProps) => (
  <span
    aria-hidden="true"
    title={`Localised — editing ${locale.toUpperCase()} content`}
    className={cx('byline-locale-badge', styles.badge)}
  >
    {locale}
  </span>
)
