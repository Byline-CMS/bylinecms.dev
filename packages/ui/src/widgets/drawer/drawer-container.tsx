'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './drawer.module.css'

type DrawerContainerIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface DrawerContainerProps extends DrawerContainerIntrinsicProps {
  className?: string
}

export function DrawerContainer({
  ref,
  children,
  className,
  ...rest
}: DrawerContainerProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cx('infonomic-drawer-container', styles['drawer-container'], className)}
      {...rest}
    >
      {children}
    </div>
  )
}
