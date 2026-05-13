import type React from 'react'

import cx from 'classnames'

import styles from './help-text.module.css'

interface HelpTextProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  text: string
}

export function HelpText({ className, size, text }: HelpTextProps): React.JSX.Element {
  return (
    <p className={cx('byline-help-text', styles.text, size && styles[size], className)}>{text}</p>
  )
}
