import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.jsx'
import type { IconProps } from './types/icon.js'

const _svgStylesDefault = 'fill-gray-800 dark:fill-white'

import styles from './icons.module.css'

export const PrimaryIcon = ({ className, svgClassName, ...rest }: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-primary'], svgClassName)

  return (
    <IconElement className={cx('primary-icon', className)} {...rest}>
      <svg className={applied} focusable="false" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20, 12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10, 10 0 0,0 12,2M11,17H13V11H11V17Z"></path>
      </svg>
    </IconElement>
  )
}
