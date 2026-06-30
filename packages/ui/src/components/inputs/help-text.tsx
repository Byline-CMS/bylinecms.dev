import type React from 'react'

import cx from 'classnames'

import styles from './help-text.module.css'

interface HelpTextProps {
  id?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
  text: string
}

export function HelpText({ id, className, size, text }: HelpTextProps): React.JSX.Element {
  return (
    <p id={id} className={cx('byline-help-text', styles.text, size && styles[size], className)}>
      {text}
    </p>
  )
}
