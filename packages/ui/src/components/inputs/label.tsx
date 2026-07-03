import type React from 'react'

import cx from 'classnames'

import styles from './label.module.css'

interface LabelProps {
  className?: string
  id: string
  htmlFor: string
  label: string
  required?: boolean
}

export function Label({ className, id, htmlFor, label, required }: LabelProps): React.JSX.Element {
  return (
    <label
      id={`label-for-${id}`}
      htmlFor={htmlFor}
      className={cx('label', styles.label, className)}
    >
      {label}
      {/* a11y: the input carries aria-required, so the visual asterisk is
          decorative — hide it from the accessible name (it would otherwise be
          read as part of the label via aria-labelledby). */}
      {required && (
        <span aria-hidden="true" className={styles.required}>
          &nbsp;*
        </span>
      )}
    </label>
  )
}
