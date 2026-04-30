/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { IconButton, Tooltip } from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './drawer-toggle.module.css'
import { useAdminMenu } from './menu-provider.js'

export function DrawerToggle() {
  const { toggleDrawer, drawerOpen } = useAdminMenu()

  return (
    <div
      className={cx('byline-admin-drawer-toggle', styles.root, {
        'byline-admin-drawer-toggle-open': drawerOpen,
        [styles.rootOpen]: drawerOpen,
        'byline-admin-drawer-toggle-closed': !drawerOpen,
        [styles.rootClosed]: !drawerOpen,
      })}
    >
      <Tooltip
        text={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        side="right"
        sideOffset={8}
      >
        <IconButton
          type="button"
          className={cx('byline-admin-drawer-toggle-button', styles.button)}
          variant="text"
          intent="noeffect"
          square={true}
          size="sm"
          onClick={toggleDrawer}
          aria-label={drawerOpen ? 'Collapse admin menu' : 'Expand admin menu'}
          aria-controls="admin-menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-label={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </IconButton>
      </Tooltip>
    </div>
  )
}
