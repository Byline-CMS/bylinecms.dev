import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

export const ChevronUpIcon = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-current'], svgClassName)

  return (
    <IconElement className={cx('chevron-up-icon', className)} {...rest}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={applied}
        role="presentation"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 15 15"
        strokeWidth={2}
      >
        <path
          d="M3.13523 8.84197C3.3241 9.04343 3.64052 9.05363 3.84197 8.86477L7.5 5.43536L11.158 8.86477C11.3595 9.05363 11.6759 9.04343 11.8648 8.84197C12.0536 8.64051 12.0434 8.32409 11.842 8.13523L7.84197 4.38523C7.64964 4.20492 7.35036 4.20492 7.15803 4.38523L3.15803 8.13523C2.95657 8.32409 2.94637 8.64051 3.13523 8.84197Z"
          fillRule="evenodd"
          clipRule="evenodd"
        ></path>
      </svg>
    </IconElement>
  )
}

ChevronUpIcon.displayName = 'ChevronUpIcon'
