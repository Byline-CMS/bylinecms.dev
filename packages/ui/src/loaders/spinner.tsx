// https://github.com/JoshK2/react-spinners-css
import type React from 'react'

import cx from 'classnames'

import styles from './spinner.module.css'
import type { LoaderProps } from './@types/index.js'

export function LoaderSpinner({
  color,
  size,
  className,
  style,
  ...rest
}: LoaderProps): React.JSX.Element {
  const circles = [...Array(12)].map((_, index) => {
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
      <div
        key={index}
        className={cx('infonomic-loader-spinner-blade', styles['loader-spinner-blade'])}
      >
        <div
          className={cx(
            'infonomic-loader-spinner-blade-inner',
            styles['loader-spinner-blade-inner']
          )}
        />
      </div>
    )
  })

  const spinnerStyle: React.CSSProperties & Record<string, string | number | undefined> = {
    ...style,
  }
  if (size != null) {
    spinnerStyle['--loader-spinner-size'] = typeof size === 'number' ? `${size}px` : size
  }
  if (color) {
    spinnerStyle['--loader-spinner-color'] = color
  }

  return (
    <div
      className={cx('infonomic-loader-spinner', styles['loader-spinner'], className)}
      style={spinnerStyle}
      {...rest}
    >
      {circles}
    </div>
  )
}
