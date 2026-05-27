'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useEffect } from 'react'

import cx from 'classnames'

import styles from './content.module.css'
import { useDocsMenu } from './docs-menu-provider.js'

interface DocsContentProps {
  children: React.ReactNode
}

export function DocsContent({ children }: DocsContentProps): React.JSX.Element {
  const { mobile, closeDrawer } = useDocsMenu()

  useEffect(() => {
    if (mobile !== true) return
    const handleWindowClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        closeDrawer()
        return
      }
      // Don't close if the click originated inside the drawer itself or on
      // the floating launcher button.
      if (target.closest('#docs-menu')) return
      if (target.closest('[aria-controls="docs-menu"]')) return
      closeDrawer()
    }
    window.addEventListener('click', handleWindowClick)
    return () => {
      window.removeEventListener('click', handleWindowClick)
    }
  }, [mobile, closeDrawer])

  return (
    <div id="byline-docs-content" className={cx('byline-docs-content', styles.root)}>
      {children}
    </div>
  )
}
