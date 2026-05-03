'use client'

import cx from 'classnames'

import { Button } from './button'
import styles from './button.module.css'
import type { ButtonProps } from './button.js'

type IconButtonProps = ButtonProps & {
  square?: boolean
  round?: boolean
}

export const IconButton = ({
  square = false,
  round = true,
  variant,
  size = 'sm',
  intent,
  className,
  children,
  ...rest
}: IconButtonProps) => {
  return (
    <Button
      variant={variant}
      size={size}
      intent={intent}
      className={cx(
        'icon-button',
        variant,
        size,
        intent,
        { [styles.square]: square },
        { [styles.round]: !square && round },
        className
      )}
      {...rest}
    >
      {children}
    </Button>
  )
}
