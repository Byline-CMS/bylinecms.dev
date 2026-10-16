import type React from 'react'

import cx from 'clsx'

import { IconElement } from './icon-element.js'
import styles from './icons.module.css'
import type { IconProps } from './types/icon.js'

/**
 * Person-with-key glyph, following the shape of the FIDO Alliance passkey
 * icon so that passkey actions read as passkeys rather than passwords.
 */
export const PasskeyIcon = ({ className, svgClassName, ...rest }: IconProps): React.JSX.Element => {
  const applied = cx(styles['fill-none'], styles['stroke-current'], svgClassName)

  return (
    <IconElement className={cx('passkey-icon', className)} {...rest}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={applied}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden="true"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <path d="M5 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path>
        <path d="M3 21v-2a4 4 0 0 1 4 -4h4"></path>
        <path d="M16 10.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0"></path>
        <path d="M18.5 13v8"></path>
        <path d="M18.5 17h2"></path>
        <path d="M18.5 19.5h1.5"></path>
      </svg>
    </IconElement>
  )
}

PasskeyIcon.displayName = 'PasskeyIcon'
