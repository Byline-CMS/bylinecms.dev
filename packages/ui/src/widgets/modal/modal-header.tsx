'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './modal.module.css'

type ModalHeaderIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ModalHeaderProps extends ModalHeaderIntrinsicProps {
  className?: string
}

export const ModalHeader = function ModalHeader({
  ref,
  children,
  className,
  ...rest
}: ModalHeaderProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  const classes = cx('infonomic-modal-header', styles['modal-header'], 'prose', className)
  return (
    <div style={{ overflowWrap: 'anywhere' }} ref={ref} {...rest} className={classes}>
      {children}
    </div>
  )
}
