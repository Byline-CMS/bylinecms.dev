import type React from 'react'

import cx from 'classnames'

import styles from './error-text.module.css'

interface ErrorTextProps {
  id: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
  text: string
}

export function ErrorText({ id, className, size, text }: ErrorTextProps): React.JSX.Element {
  return (
    <p id={id} className={cx('error-text', styles.text, size && styles[size], className)}>
      {text}
    </p>
  )
}
