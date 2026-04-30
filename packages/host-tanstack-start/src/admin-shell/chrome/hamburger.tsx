'use client'

import type React from 'react'

import cx from 'classnames'

import styles from './hamburger.module.css'
import { useAdminMenu } from './menu-provider.js'

interface HamburgerProps {
  className?: string
  /** Tailwind/utility class string applied to the inner bar; defaults to a white-on-dark fill. */
  color?: string
  activeBorderColor?: string
}

export function Hamburger({
  className,
  color = 'bg-white before:bg-white after:bg-white',
  activeBorderColor: _activeBorderColor,
  ...other
}: HamburgerProps): React.JSX.Element {
  const { toggleDrawer } = useAdminMenu()

  // Hard code the drawer hamburger to always closed
  // to prevent the 'X' pattern from being the default
  // on desktop. For a drawer like this - the hamburger
  // icon doesn't have to animate.
  const drawerOpen = false

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (event != null) event.stopPropagation()
    toggleDrawer()
  }

  return (
    <button
      onClick={handleClick}
      className={cx(
        'byline-admin-hamburger',
        styles.button,
        `component--hamburger ${drawerOpen ? 'is_active' : ''}`,
        className
      )}
      tabIndex={0}
      aria-label="Open admin menu"
      aria-controls="admin-menu"
      aria-haspopup="true"
      {...other}
    >
      <span className="box" aria-hidden="true">
        <span className={cx('inner', color)} />
      </span>
    </button>
  )
}
