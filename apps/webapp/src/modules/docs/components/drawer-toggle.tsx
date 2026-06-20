/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { IconButton, Tooltip } from '@byline/ui/react'
import cx from 'classnames'

import { useDocsMenu } from './docs-provider.js'
import styles from './drawer-toggle.module.css'

export function DocsDrawerToggle() {
  const { toggleDrawer, drawerOpen } = useDocsMenu()

  return (
    <Tooltip text={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'} side="bottom" sideOffset={8}>
      <IconButton
        type="button"
        className={cx('byline-docs-drawer-toggle-button', styles.button)}
        variant="text"
        intent="noeffect"
        square={true}
        size="sm"
        onClick={toggleDrawer}
        aria-label={drawerOpen ? 'Collapse docs menu' : 'Expand docs menu'}
        aria-controls="docs-menu"
        aria-expanded={drawerOpen}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </IconButton>
    </Tooltip>
  )
}
