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

import { LangLink } from '@/i18n/components/lang-link.tsx'
import { pathWithoutLocale } from '@/i18n/utils'
import { useAbilities } from '@/lib/abilities.tsx'
import { useAdminMenu } from './menu-provider.tsx'

import './menu-drawer.css'

const isActive = (currentPath: string, linkHref: string): boolean => {
  const path = pathWithoutLocale(currentPath)
  // Root admin highlights only on exact match so it doesn't stay lit on
  // every admin subpath.
  if (linkHref === '/admin') return path === '/admin'
  return path.startsWith(linkHref)
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
      <LangLink to={to}>
        <span className="icon">{icon}</span>
        <span className="label">{label}</span>
      </LangLink>
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

  // On mobile the toggle is a single fixed-position button that slides
  // between two spots: x=8 when the drawer is closed (standalone
  // launcher) and x=186 when open (docked on the drawer's right edge,
  // ~24px poke-out past aside.right=210). Using one button rather than
  // a launcher + drawer-edge pair avoids ever showing two chevrons at
  // once — the drawer-edge chevron would otherwise peek through when the

  return (
    <aside
      id="admin-menu"
      className={cx(
        'flex flex-col',
        'border-r border-canvas-200 bg-canvas-25 dark:border-canvas-800 dark:bg-canvas-800',
        'z-[15] transition-all duration-300 ease-in-out',
        // Mobile: fixed overlay, taken out of flow. Open = 210px, closed = 0px.
        mobile === true && 'fixed top-[45px] bottom-0 left-0',
        mobile === true && (drawerOpen === true ? 'w-[210px]' : 'w-0 overflow-hidden'),
        // Desktop: inline column. `relative` positions the edge toggle.
        // Open = 210px with labels, closed = 60px icons-only.
        mobile === false && 'relative self-stretch flex-shrink-0',
        mobile === false && (drawerOpen === true ? 'w-[210px]' : 'w-[60px]')
      )}
      {...handlers}
    >
      <nav className="admin-menu-drawer">
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
