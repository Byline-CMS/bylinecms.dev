// https://github.com/JoshK2/react-spinners-css
import type React from 'react'

import cx from 'classnames'

import styles from './ellipses.module.css'
import type { LoaderProps } from './@types/index.js'

export function LoaderEllipsis({
  color,
  size,
  className,
  style,
  ...rest
}: LoaderProps): React.JSX.Element {
  const ellipsisStyle: React.CSSProperties & Record<string, string | number | undefined> = {
    ...style,
  }
  if (size != null) {
    ellipsisStyle['--loader-ellipsis-size'] = typeof size === 'number' ? `${size}px` : size
  }
  if (color) {
    ellipsisStyle['--loader-ellipsis-color'] = color
  }

  const circles = [...Array(4)].map((_, index) => (
    <div
      // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
      key={index}
      className={cx('infonomic-loader-ellipsis-dot', styles['loader-ellipsis-dot'])}
    />
  ))

  return (
    <div
      className={cx('infonomic-loader-ellipsis', styles['loader-ellipsis'], className)}
      style={ellipsisStyle}
      {...rest}
    >
      {circles}
    </div>
  )
}
