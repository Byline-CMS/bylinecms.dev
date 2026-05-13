'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './modal.module.css'

type ModalContainerIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ModalContainerProps extends ModalContainerIntrinsicProps {
  className?: string
}

export const ModalContainer = function ModalContainer({
  ref,
  children,
  className,
  ...rest
}: ModalContainerProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cx('byline-modal-container', styles['modal-container'], className)}
      {...rest}
    >
      {children}
    </div>
  )
}
