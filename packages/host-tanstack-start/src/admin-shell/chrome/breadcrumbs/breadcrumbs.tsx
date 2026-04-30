/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import cx from 'classnames'

import { Link } from '../loose-router.js'
import styles from './breadcrumbs.module.css'
import type { Breadcrumb } from './@types.js'

function truncate(str: string, length: number, useWordBoundary = true, useSuffix = true): string {
  if (str == null || str.length <= length) return str
  const subString = str.slice(0, length - 2)
  const truncated = useWordBoundary ? subString.slice(0, subString.lastIndexOf(' ')) : subString
  return useSuffix ? `${truncated}...` : truncated
}

export function Breadcrumbs({
  breadcrumbs,
  className,
  homeLabel = 'Home',
  homePath = '/',
}: {
  breadcrumbs: Breadcrumb[]
  className?: string
  homeLabel?: string
  homePath?: string
}): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className={cx('byline-breadcrumbs', styles.nav, className)}>
      <ul className={cx('byline-breadcrumbs-list', styles.list)}>
        <li className={cx('byline-breadcrumbs-item', styles.item)}>
          <Link to={homePath as string} className={cx('byline-breadcrumbs-link', styles.link)}>
            <svg
              role="presentation"
              className={cx('byline-breadcrumbs-home-icon', styles.homeIcon)}
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            {homeLabel}
          </Link>
        </li>
        {breadcrumbs != null &&
          breadcrumbs.length > 0 &&
          breadcrumbs.map((breadcrumb, index) => {
            const isLeaf = index === breadcrumbs.length - 1
            return (
              <li
                key={breadcrumb.href}
                aria-current={isLeaf ? 'page' : undefined}
                className={cx('byline-breadcrumbs-item', styles.item)}
              >
                <div className={cx('byline-breadcrumbs-item-row', styles.item)}>
                  <svg
                    role="presentation"
                    className={cx('byline-breadcrumbs-chevron', styles.chevron, {
                      'byline-breadcrumbs-chevron-current': isLeaf,
                      [styles.chevronCurrent]: isLeaf,
                    })}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {isLeaf ? (
                    <span className={cx('byline-breadcrumbs-leaf', styles.leaf)}>
                      {truncate(breadcrumb.label, 20, true)}
                    </span>
                  ) : (
                    <Link
                      to={breadcrumb.href as string}
                      className={cx('byline-breadcrumbs-link', styles.link)}
                    >
                      {truncate(breadcrumb.label, 20, true)}
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
      </ul>
    </nav>
  )
}
