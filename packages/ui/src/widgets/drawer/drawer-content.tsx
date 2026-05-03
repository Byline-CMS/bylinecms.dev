'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './drawer.module.css'

type DrawerContentIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface DrawerContentProps extends DrawerContentIntrinsicProps {
  className?: string
}

export function DrawerContent({
  ref,
  children,
  className,
  ...rest
}: DrawerContentProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('infonomic-drawer-content', styles['drawer-content'], className)}
    >
      {children}
    </div>
  )
}
