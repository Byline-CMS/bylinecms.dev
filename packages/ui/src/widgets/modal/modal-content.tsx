'use client'

import type * as React from 'react'

import cx from 'classnames'

import styles from './modal.module.css'

type ModalContentIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ModalContentProps extends ModalContentIntrinsicProps {
  className?: string
}

export const ModalContent = function ModalContent({
  ref,
  children,
  className,
  ...rest
}: ModalContentProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx('infonomic-modal-content', styles['modal-content'], className)}
    >
      {children}
    </div>
  )
}
