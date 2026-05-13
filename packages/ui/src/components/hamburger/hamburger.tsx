'use client'

import type React from 'react'
import { useCallback, useEffect } from 'react'

import cx from 'classnames'

import styles from './hamburger.module.css'

type ColorScheme = 'auto' | 'onDark' | 'onLight'

export interface HamburgerProps {
  className?: string
  colorScheme?: ColorScheme
  open?: boolean
  onChange?: (open: boolean) => void
  ariaLabel?: string
  ariaControls?: string
}

export function Hamburger({
  className,
  colorScheme = 'auto',
  open = false,
  onChange,
  ariaLabel = 'Toggle menu',
  ariaControls,
  ...other
}: HamburgerProps): React.JSX.Element {
  const handleClick = (event: React.MouseEvent): void => {
    event.stopPropagation()
    onChange?.(!open)
  }

  const handleEscapeKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && open) {
        onChange?.(false)
      }
    },
    [open, onChange]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleEscapeKey, false)
    return () => {
      document.removeEventListener('keydown', handleEscapeKey, false)
    }
  }, [handleEscapeKey])

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cx(
        'byline-hamburger',
        styles.hamburger,
        {
          [styles.open]: open,
          [styles.onDark]: colorScheme === 'onDark',
          [styles.onLight]: colorScheme === 'onLight',
        },
        className
      )}
      aria-label={ariaLabel}
      aria-controls={ariaControls}
      aria-expanded={open}
      {...other}
    >
      <span className={cx('byline-hamburger-box', styles.box)} aria-hidden="true">
        <span className={cx('byline-hamburger-inner', styles.inner)} />
      </span>
    </button>
  )
}
