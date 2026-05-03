import type React from 'react'

import cx from 'classnames'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

export const SearchMenuIcon = ({
  className,
  svgClassName,
  ...rest
}: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-gray'], svgClassName)
  return (
    <IconElement className={cx('search-menu-icon', className)} {...rest}>
      <svg
        className={applied}
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 24 24"
      >
        <g>
          <path
            d="M20.28,13.98l-0.73-0.14l-0.21-0.3c1.1-0.88,1.89-2.13,2.17-3.61c0.62-3.29-1.55-6.47-4.84-7.09S10.21,4.4,9.59,7.69
		s1.55,6.47,4.84,7.09c1.48,0.28,2.94-0.01,4.15-0.71l0.2,0.3l-0.14,0.73l3.73,5.44L24,19.43L20.28,13.98z M14.78,12.95
		c-2.29-0.43-3.78-2.62-3.35-4.91s2.62-3.78,4.91-3.35s3.78,2.62,3.35,4.91C19.25,11.88,17.06,13.38,14.78,12.95z"
          />
          {/* NOTE: rect height below has been 'tweaked' for Firefox on MacOS */}
          <rect y="4.39" width="9.05" height="1.86" />
          <rect y="11.85" width="9.05" height="1.82" />
          <rect y="19.31" width="18.07" height="1.74" />
        </g>
      </svg>
    </IconElement>
  )
}

SearchMenuIcon.displayName = 'SearchMenuIcon'
