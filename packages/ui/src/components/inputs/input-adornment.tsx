import type React from 'react'

import cx from 'classnames'

import styles from './input-adornment.module.css'

type InputAdornmentIntrinsicProps = React.JSX.IntrinsicElements['div']
export interface InputAdornmentProps extends InputAdornmentIntrinsicProps {
  className?: string
  position?: 'start' | 'end'
  margins?: boolean
  children: React.ReactNode
}

export function InputAdornment({
  position = 'start',
  margins = true,
  className,
  children,
  ...rest
}: InputAdornmentProps): React.JSX.Element {
  return (
    <div
      className={cx(
        'infonomic-input-adornment',
        `infonomic-input-adornment-${position}`,
        styles.adornment,
        { [styles.start]: position === 'start' },
        { [styles.end]: position === 'end' },
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
