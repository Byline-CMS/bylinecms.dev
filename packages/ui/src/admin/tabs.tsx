/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Badge } from '@infonomic/uikit/react'
import cx from 'classnames'

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
 */
export const Tabs = ({ tabs, activeTab, onChange, errorCounts, className }: TabsProps) => {
  return (
    <div
      role="tablist"
      aria-label="Form tabs"
      className={cx('flex gap-4 border-b border-gray-200 dark:border-gray-700', className)}
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
              'relative py-2.5 text-[1.1rem] font-medium -mb-px border-b-2 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              isActive
                ? 'border-primary-400 text-primary-600 dark:text-primary-200 dark:border-primary-400'
                : [
                    'border-transparent',
                    'text-gray-500 dark:text-gray-400',
                    'hover:text-gray-800 dark:hover:text-gray-200',
                    'hover:border-gray-300 dark:hover:border-gray-600',
                  ]
            )}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {(errorCounts?.[tab.name] ?? 0) > 0 && (
                <Badge
                  intent="danger"
                  className="text-[0.7rem] px-1.5 py-0 min-w-[1.25rem] h-[1.25rem] flex items-center justify-center"
                >
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
