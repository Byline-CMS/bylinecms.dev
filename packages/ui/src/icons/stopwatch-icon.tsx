import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element'
import styles from './icons.module.css'
import type { IconProps } from './types/icon'

export const StopwatchIcon = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-current'], styles['stroke-none'], svgClassName)

  return (
    <IconElement className={cx('stopwatch-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 15 15"
        strokeWidth="0"
      >
        <path
          // fill="currentColor"
          fillRule="evenodd"
          d="M5.5.5A.5.5 0 0 1 6 0h3a.5.5 0 0 1 0 1H8v1.12a6.363 6.363 0 0 1 2.992 1.016a.638.638 0 0 1 .066-.078l.8-.8a.625.625 0 0 1 .884.884l-.775.775A6.4 6.4 0 1 1 7 2.119V1H6a.5.5 0 0 1-.5-.5m-3.4 8a5.4 5.4 0 1 1 10.8 0a5.4 5.4 0 0 1-10.8 0m5.9-4a.5.5 0 0 0-1 0v5a.5.5 0 1 0 1 0z"
          clipRule="evenodd"
        />
      </svg>
    </IconElement>
  )
}

StopwatchIcon.displayName = 'StopwatchIcon'
