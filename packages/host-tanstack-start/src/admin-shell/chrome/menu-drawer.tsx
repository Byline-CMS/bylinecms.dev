/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useRouterState } from '@tanstack/react-router'

import { ADMIN_PERMISSIONS_ABILITIES } from '@byline/admin/admin-permissions'
import { ADMIN_ROLES_ABILITIES } from '@byline/admin/admin-roles'
import { ADMIN_USERS_ABILITIES } from '@byline/admin/admin-users'
import {
  HomeIcon,
  RolesIcon,
  SettingsSlidersIcon,
  UserIcon,
  UsersIcon,
} from '@infonomic/uikit/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { useAbilities } from '../../integrations/abilities.js'
import { Link } from './loose-router.js'
import styles from './menu-drawer.module.css'
import { useAdminMenu } from './menu-provider.js'
import { PreviewToggle } from './preview-toggle.js'

const isActive = (currentPath: string, linkHref: string): boolean => {
  // Root admin highlights only on exact match so it doesn't stay lit on
  // every admin subpath.
  if (linkHref === '/admin') return currentPath === '/admin'
  return currentPath.startsWith(linkHref)
}

interface MenuItemProps {
  to: string
  label: string
  icon: React.ReactNode
  pathname: string
  compact: boolean
}

function MenuItem({ to, label, icon, pathname, compact }: MenuItemProps) {
  return (
    <li className={cx('menu-item', { active: isActive(pathname, to), compact })}>
      <Link to={to}>
        <span className="icon">{icon}</span>
        <span className="label">{label}</span>
      </Link>
    </li>
  )
}

export function AdminMenuDrawer(): React.JSX.Element | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { mobile, drawerOpen, closeDrawer } = useAdminMenu()

  // Cosmetic ability cues — hide the admin-management section entirely
  // when the user holds none of its read abilities. Server-side
  // `assertAdminActor` is the actual gate for each module's commands;
  // these checks just keep the drawer from advertising areas the user
  // can't enter.
  const { has } = useAbilities()
  const canReadUsers = has(ADMIN_USERS_ABILITIES.read)
  const canReadRoles = has(ADMIN_ROLES_ABILITIES.read)
  const canReadPermissions = has(ADMIN_PERMISSIONS_ABILITIES.read)
  const showAdminSection = canReadUsers || canReadRoles || canReadPermissions

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      closeDrawer()
    },
  })

  // Compact = icon-only. Only applies to the desktop-closed state; the
  // mobile overlay always renders with full labels for readability.
  const compact = mobile === false && drawerOpen === false

  return (
    <aside
      id="admin-menu"
      className={cx('byline-admin-menu-drawer-aside', styles.aside, {
        'byline-admin-menu-drawer-aside-mobile': mobile === true,
        [styles.asideMobile]: mobile === true,
        'byline-admin-menu-drawer-aside-mobile-open': mobile === true && drawerOpen === true,
        [styles.asideMobileOpen]: mobile === true && drawerOpen === true,
        'byline-admin-menu-drawer-aside-mobile-closed': mobile === true && drawerOpen === false,
        [styles.asideMobileClosed]: mobile === true && drawerOpen === false,
        'byline-admin-menu-drawer-aside-desktop': mobile === false,
        [styles.asideDesktop]: mobile === false,
        'byline-admin-menu-drawer-aside-desktop-open': mobile === false && drawerOpen === true,
        [styles.asideDesktopOpen]: mobile === false && drawerOpen === true,
        'byline-admin-menu-drawer-aside-desktop-closed': mobile === false && drawerOpen === false,
        [styles.asideDesktopClosed]: mobile === false && drawerOpen === false,
      })}
      {...handlers}
    >
      <nav className={cx('byline-admin-menu-drawer admin-menu-drawer', styles.nav)}>
        <ul>
          <MenuItem
            to="/admin"
            label="Dashboard"
            icon={<HomeIcon width="20px" height="20px" />}
            pathname={pathname}
            compact={compact}
          />
          {showAdminSection && (
            <>
              <li className="menu-separator" />
              {canReadUsers && (
                <MenuItem
                  to="/admin/users"
                  label="Admin Users"
                  icon={<UsersIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
              {canReadRoles && (
                <MenuItem
                  to="/admin/roles"
                  label="Admin Roles"
                  icon={<RolesIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
              {canReadPermissions && (
                <MenuItem
                  to="/admin/permissions"
                  label="Permissions"
                  icon={<SettingsSlidersIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
            </>
          )}
          <li className="menu-separator" />
          <PreviewToggle compact={compact} />
          <MenuItem
            to="/admin/account"
            label="Account"
            icon={<UserIcon />}
            pathname={pathname}
            compact={compact}
          />
        </ul>
      </nav>
    </aside>
  )
}
