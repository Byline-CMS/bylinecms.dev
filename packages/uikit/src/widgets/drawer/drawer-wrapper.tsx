'use client'

/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/* eslint-disable @typescript-eslint/consistent-type-imports */
import type React from 'react'
import { useEffect } from 'react'

import { useFocusTrap } from '@mantine/hooks'
import cx from 'classnames'
import type { HTMLMotionProps } from 'motion/react'
import { m } from 'motion/react'

import styles from './drawer.module.css'

export interface DrawerWrapperProps extends HTMLMotionProps<'div'> {
  className?: string
  children: React.ReactNode
  onEscapeKey?: (e: any) => void
}

export function DrawerWrapper({
  className,
  children,
  onEscapeKey,
  ...rest
}: DrawerWrapperProps): React.JSX.Element {
  const focusTrapRef = useFocusTrap()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeKey) {
        onEscapeKey(event)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onEscapeKey])

  return (
    <m.div
      ref={focusTrapRef}
      {...rest}
      className={cx(styles['drawer-wrapper'], className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {children}
    </m.div>
  )
}
