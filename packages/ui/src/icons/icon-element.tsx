import type React from 'react'
import type { ReactNode } from 'react'

import cx from 'classnames'

import styles from './icons.module.css'

export interface IconElementProps extends React.ComponentProps<'div'> {
  width?: string
  height?: string
  menuItem?: boolean
  children: ReactNode
  className?: string
}

export const IconElement = (props: IconElementProps): React.JSX.Element => {
  const { className, children, width, height, menuItem = false, ...rest } = props
  return (
    <div
      style={{
        width,
        height,
        marginRight: menuItem != null && menuItem ? '1.2rem' : '0',
      }}
      className={cx(styles['element-root'], className)}
      {...rest}
    >
      {children}
    </div>
  )
}
