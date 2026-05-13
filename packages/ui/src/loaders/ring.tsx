// https://github.com/JoshK2/react-spinners-css
import type React from 'react'

import cx from 'classnames'

import styles from './ring.module.css'
import type { LoaderProps } from './@types/index.js'

export function LoaderRing({
  color,
  size,
  className,
  style,
  ...rest
}: LoaderProps): React.JSX.Element {
  const ringStyle: React.CSSProperties & Record<string, string | number | undefined> = {
    ...style,
  }
  if (size != null) {
    ringStyle['--loader-ring-size'] = typeof size === 'number' ? `${size}px` : size
  }
  if (color) {
    ringStyle['--loader-ring-color'] = color
  }

  const circles = [...Array(4)].map((_, index) => {
    return (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
        key={index}
        className={cx('byline-loader-ring-arc', styles['loader-ring-arc'])}
      />
    )
  })

  return (
    <div
      className={cx('byline-loader-ring', styles['loader-ring'], className)}
      style={ringStyle}
      {...rest}
    >
      {circles}
    </div>
  )
}
