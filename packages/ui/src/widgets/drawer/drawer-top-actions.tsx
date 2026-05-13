'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './drawer.module.css'

type DrawerTopActionIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface DrawerTopActionProps extends DrawerTopActionIntrinsicProps {
  className?: string
}

export const DrawerTopActions = function DrawerHeader({
  ref,
  children,
  className,
  ...rest
}: DrawerTopActionProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  const classes = cx('byline-drawer-top-actions', styles['drawer-top-actions'], className)
  return (
    <div style={{ whiteSpace: 'nowrap' }} ref={ref} {...rest} className={classes}>
      {children}
    </div>
  )
}
