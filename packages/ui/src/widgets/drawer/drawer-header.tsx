'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './drawer.module.css'

type DrawerHeaderIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface DrawerHeaderProps extends DrawerHeaderIntrinsicProps {
  className?: string
}

export const DrawerHeader = function DrawerHeader({
  ref,
  children,
  className,
  ...rest
}: DrawerHeaderProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  const classes = cx('infonomic-drawer-header', styles['drawer-header'], className)
  return (
    <div style={{ overflowWrap: 'anywhere' }} ref={ref} {...rest} className={classes}>
      {children}
    </div>
  )
}
