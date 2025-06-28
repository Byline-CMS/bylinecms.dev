import cx from 'classnames'
import type React from 'react'

import { IconElement } from './icon-element.jsx'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

export const ChevronsUpDown = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['stroke-contrast'], svgClassName)

  return (
    <IconElement className={cx('chevrons-up-down', className)} {...rest}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={applied}
        role="presentation"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m7 15 5 5 5-5" />
        <path d="m7 9 5-5 5 5" />
      </svg>
    </IconElement>
  )
}

ChevronsUpDown.displayName = 'ChevronsUpDown'
