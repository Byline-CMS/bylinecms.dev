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
      {required && <span className={styles.required}>&nbsp;*</span>}
    </label>
  )
}
