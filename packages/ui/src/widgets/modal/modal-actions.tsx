'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './modal.module.css'

type ModalActionsIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ModalActionsProps extends ModalActionsIntrinsicProps {
  className?: string
}

export const ModalActions = function ModalActions({
  ref,
  children,
  className,
  ...rest
}: ModalActionsProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('infonomic-modal-actions', styles['modal-actions'], className)}
    >
      {children}
    </div>
  )
}
