import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

export const HomeIcon = ({ className, svgClassName, ...rest }: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-none'], styles['stroke-current'], svgClassName)

  return (
    <IconElement className={cx('home-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        strokeWidth={1.75}
      >
        <path d="M5 12l-2 0l9 -9l9 9l-2 0"></path>{' '}
        <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"></path>{' '}
        <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"></path>{' '}
      </svg>
    </IconElement>
  )
}

HomeIcon.displayName = 'HomeIcon'
