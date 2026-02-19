import type React from 'react'

import cx from 'classnames'

import './warning-icon.css'

interface Props {
  className?: string
}

export function WarningIcon({ className, ...rest }: Props): React.JSX.Element {
  return (
    <div className={cx('warning-icon', className)} {...rest}>
      <svg focusable="false" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"></path>
      </svg>
    </div>
  )
}
