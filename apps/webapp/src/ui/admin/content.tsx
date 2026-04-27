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

import { useAdminMenu } from './menu-provider.tsx'

/**
 * Wrapper for the main content area of the admin shell.
 *
 * With the new drawer model there is no margin trick to perform — the
 * drawer is inline in the flex row on desktop (flex reclaims space
 * automatically when it narrows to icon-only) and fully fixed-positioned
 * on mobile (doesn't affect flow). This wrapper therefore just renders
 * the content stream and adds one behaviour: a window click listener
 * that closes the mobile overlay when the user taps outside it.
 */
interface ContentProps {
  children: React.ReactNode
}

export function Content({ children }: ContentProps): React.JSX.Element {
  const { mobile, closeDrawer } = useAdminMenu()

  useEffect(() => {
    if (mobile !== true) return
    const handleWindowClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) {
        closeDrawer()
        return
      }
      // Don't close if the click originated inside the drawer itself or on
      // the floating launcher button (both carry an `aria-controls` /
      // `id` of `admin-menu`). Without this guard the open-click would
      // race the window listener and immediately close the drawer it just
      // opened.
      if (target.closest('#admin-menu')) return
      if (target.closest('[aria-controls="admin-menu"]')) return
      closeDrawer()
    }
    window.addEventListener('click', handleWindowClick)
    return () => {
      window.removeEventListener('click', handleWindowClick)
    }
  }, [mobile, closeDrawer])

  return <div className="flex min-w-0 flex-1 flex-col pt-4 pb-6 min-h-0">{children}</div>
}
