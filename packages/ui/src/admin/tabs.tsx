/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Badge } from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './tabs.module.css'

export interface TabItem {
  name: string
  label: string
}

interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onChange: (name: string) => void
  /** Error counts keyed by tab name — shows a danger badge when > 0. */
  errorCounts?: Record<string, number>
  className?: string
}

/**
 * Tabs navigation bar for admin form layouts.
 *
 * Used by FormRenderer when a CollectionAdminConfig declares a `tabs` array.
 * Each tab is a simple button with a bottom-border active indicator.
 * Inactive tabs show a subtle hover state. Fully dark-mode aware.
 *
 * Stable override handles: `.byline-admin-tabs`, `.byline-admin-tab`,
 * `.byline-admin-tab-active`, `.byline-admin-tab-label`,
 * `.byline-admin-tab-badge`.
 */
export const Tabs = ({ tabs, activeTab, onChange, errorCounts, className }: TabsProps) => {
  return (
    <div
      role="tablist"
      aria-label="Form tabs"
      className={cx('byline-admin-tabs', styles.tabs, className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.name === activeTab
        return (
          <button
            key={tab.name}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.name)}
            className={cx(
              'byline-admin-tab',
              styles.tab,
              isActive && ['byline-admin-tab-active', styles['tab-active']]
            )}
          >
            <span className={cx('byline-admin-tab-label', styles.label)}>
              {tab.label}
              {(errorCounts?.[tab.name] ?? 0) > 0 && (
                <Badge intent="danger" className={cx('byline-admin-tab-badge', styles.badge)}>
                  {errorCounts?.[tab.name]}
                </Badge>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
