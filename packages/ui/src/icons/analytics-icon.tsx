import type React from 'react'

import cx from 'clsx'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

/**
 * Columns standing on an L-shaped axis. After lucide `chart-column-increasing`
 * (ISC), redrawn to this set's 1.75 stroke; source kept in
 * `source/icon-analytics.svg`. The column feet terminate one unit above the
 * axis so their round caps meet it rather than crossing it.
 *
 * Distinct from `DashboardIcon`, which is a four-panel layout grid and reads as
 * "dashboard", not "measurement".
 */
export const AnalyticsIcon = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-none'], styles['stroke-current'], svgClassName)

  return (
    <IconElement className={cx('analytics-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
      >
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="M8 20v-4" />
        <path d="M13 20v-9" />
        <path d="M18 20v-13" />
      </svg>
    </IconElement>
  )
}

AnalyticsIcon.displayName = 'AnalyticsIcon'
