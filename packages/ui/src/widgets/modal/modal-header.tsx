'use client'

import * as React from 'react'
import { useContext } from 'react'

import cx from 'clsx'

import styles from './modal.module.css'
import { ModalContext } from './modal-context.js'

type ModalHeaderIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface ModalHeaderProps extends ModalHeaderIntrinsicProps {
  className?: string
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * Give the dialog's heading the id that `Modal` points `aria-labelledby` at.
 *
 * The heading is found rather than declared, so no caller has to change: every
 * header in the admin is written as a heading element optionally followed by a
 * close button. Only the first heading is labelled, and only direct children
 * are searched — a header deep enough to hide its heading is better served by
 * `Modal`'s explicit `ariaLabel`.
 *
 * `Modal.Header` owns the heading's `id` for this reason; an id set by a caller
 * is replaced, because the dialog's name depends on this one resolving.
 */
function labelHeading(children: React.ReactNode, headingId: string): React.ReactNode {
  let labelled = false
  return React.Children.map(children, (child) => {
    if (labelled || !React.isValidElement(child)) return child
    if (typeof child.type !== 'string' || !HEADING_TAGS.has(child.type)) return child
    labelled = true
    return React.cloneElement(child as React.ReactElement<{ id?: string }>, { id: headingId })
  })
}

export const ModalHeader = function ModalHeader({
  ref,
  children,
  className,
  ...rest
}: ModalHeaderProps & {
  ref?: React.RefObject<HTMLDivElement>
}) {
  const { headingId } = useContext(ModalContext)
  const classes = cx('byline-modal-header', styles['modal-header'], 'prose', className)
  return (
    <div style={{ overflowWrap: 'anywhere' }} ref={ref} {...rest} className={classes}>
      {headingId == null ? children : labelHeading(children, headingId)}
    </div>
  )
}
