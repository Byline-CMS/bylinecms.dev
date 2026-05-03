import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.jsx'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

export const HistoryIcon = ({ className, svgClassName, ...rest }: IconProps): React.JSX.Element => {
  const applied = cx(styles['stroke-current'], svgClassName)

  return (
    <IconElement className={cx('history-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M12 7v5l4 2" />
      </svg>
    </IconElement>
  )
}

HistoryIcon.displayName = 'HistoryIcon'
