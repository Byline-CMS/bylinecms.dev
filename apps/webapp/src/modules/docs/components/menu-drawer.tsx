/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { Link, useParams } from '@tanstack/react-router'

import { DocumentIcon } from '@byline/ui/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { lngParam } from '@/i18n/hooks/use-locale-navigation'
import { useDocsMenu } from './docs-menu-provider.js'
import styles from './menu-drawer.module.css'
import type { Locale } from '@/i18n/i18n-config'
import type { DocListItem } from '@/modules/docs/list'

interface MenuItemProps {
  doc: DocListItem
  active: boolean
  compact: boolean
  lng: Locale
  onNavigate: () => void
}

function MenuItem({ doc, active, compact, lng, onNavigate }: MenuItemProps) {
  const title = doc.fields.title ?? doc.path ?? doc.id

  return (
    <li className={cx('menu-item', { active, compact })}>
      <Link
        to="/{-$lng}/docs/$path"
        params={{ ...lngParam(lng), path: doc.path }}
        onClick={onNavigate}
      >
        <span className="icon">
          <DocumentIcon width="20px" height="20px" />
        </span>
        <span className="label">{title}</span>
      </Link>
    </li>
  )
}

interface DocsMenuDrawerProps {
  docs: DocListItem[]
  lng: Locale
}

export function DocsMenuDrawer({ docs, lng }: DocsMenuDrawerProps): React.JSX.Element | null {
  const { mobile, drawerOpen, closeDrawer } = useDocsMenu()
  const params = useParams({ strict: false }) as { path?: string }
  const currentPath = params.path

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      closeDrawer()
    },
  })

  // Compact = icon-only. Only applies to the desktop-closed state; the
  // mobile overlay always renders with full labels for readability.
  const compact = mobile === false && drawerOpen === false

  // On the index route there is no $path param yet; fall back to the first doc
  // so the default detail view still gets highlighted.
  const activePath = currentPath ?? docs[0]?.path

  return (
    <aside
      id="docs-menu"
      className={cx('byline-docs-menu-drawer-aside', styles.aside, {
        'byline-docs-menu-drawer-aside-mobile': mobile === true,
        [styles.asideMobile]: mobile === true,
        'byline-docs-menu-drawer-aside-mobile-open': mobile === true && drawerOpen === true,
        [styles.asideMobileOpen]: mobile === true && drawerOpen === true,
        'byline-docs-menu-drawer-aside-mobile-closed': mobile === true && drawerOpen === false,
        [styles.asideMobileClosed]: mobile === true && drawerOpen === false,
        'byline-docs-menu-drawer-aside-desktop': mobile === false,
        [styles.asideDesktop]: mobile === false,
        'byline-docs-menu-drawer-aside-desktop-open': mobile === false && drawerOpen === true,
        [styles.asideDesktopOpen]: mobile === false && drawerOpen === true,
        'byline-docs-menu-drawer-aside-desktop-closed': mobile === false && drawerOpen === false,
        [styles.asideDesktopClosed]: mobile === false && drawerOpen === false,
      })}
      {...handlers}
    >
      <nav className={cx('byline-docs-menu-drawer docs-menu-drawer', styles.nav)}>
        <ul>
          {docs.map((doc) => (
            <MenuItem
              key={doc.id}
              doc={doc}
              active={activePath === doc.path}
              compact={compact}
              lng={lng}
              onNavigate={closeDrawer}
            />
          ))}
        </ul>
      </nav>
    </aside>
  )
}
