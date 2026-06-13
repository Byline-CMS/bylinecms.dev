/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useRouterState } from '@tanstack/react-router'

import { ADMIN_ACTIVITY_ABILITIES } from '@byline/admin/admin-activity'
import { ADMIN_PERMISSIONS_ABILITIES } from '@byline/admin/admin-permissions'
import { ADMIN_ROLES_ABILITIES } from '@byline/admin/admin-roles'
import { ADMIN_USERS_ABILITIES } from '@byline/admin/admin-users'
import { useTranslation } from '@byline/i18n/react'
import {
  ActivityIcon,
  HomeIcon,
  RolesIcon,
  SettingsSlidersIcon,
  Tooltip,
  UserIcon,
  UsersIcon,
} from '@byline/ui/react'
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
  // In the compact (icon-only) state the label text is hidden, so a tooltip on
  // the icon is the only way to discover what the item is. When labels are
  // visible the tooltip would be redundant, so it's gated on `compact`. The
  // span is the trigger (not the bare icon) so the ref / hover handlers Base UI
  // merges always land on a DOM node regardless of how each icon forwards props.
  const iconSpan = <span className="icon">{icon}</span>
  return (
    <li className={cx('menu-item', { active: isActive(pathname, to), compact })}>
      <Link to={to}>
        {compact ? (
          <Tooltip text={label} side="right">
            {iconSpan}
          </Tooltip>
        ) : (
          iconSpan
        )}
        <span className="label">{label}</span>
      </Link>
    </li>
  )
}

export function AdminMenuDrawer(): React.JSX.Element | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { mobile, drawerOpen, closeDrawer } = useAdminMenu()
  const { t } = useTranslation('byline-admin')

  // Cosmetic ability cues — hide the admin-management section entirely
  // when the user holds none of its read abilities. Server-side
  // `assertAdminActor` is the actual gate for each module's commands;
  // these checks just keep the drawer from advertising areas the user
  // can't enter.
  const { has } = useAbilities()
  const canReadUsers = has(ADMIN_USERS_ABILITIES.read)
  const canReadRoles = has(ADMIN_ROLES_ABILITIES.read)
  const canReadPermissions = has(ADMIN_PERMISSIONS_ABILITIES.read)
  const canReadActivity = has(ADMIN_ACTIVITY_ABILITIES.read)
  const showAdminSection = canReadUsers || canReadRoles || canReadPermissions || canReadActivity

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
            label={t('chrome.menu.dashboard')}
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
                  label={t('chrome.menu.adminUsers')}
                  icon={<UsersIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
              {canReadRoles && (
                <MenuItem
                  to="/admin/roles"
                  label={t('chrome.menu.adminRoles')}
                  icon={<RolesIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
              {canReadPermissions && (
                <MenuItem
                  to="/admin/permissions"
                  label={t('chrome.menu.permissions')}
                  icon={<SettingsSlidersIcon width="20px" height="20px" />}
                  pathname={pathname}
                  compact={compact}
                />
              )}
              {canReadActivity && (
                <MenuItem
                  to="/admin/activity"
                  label={t('chrome.menu.activity')}
                  icon={<ActivityIcon width="20px" height="20px" />}
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
            label={t('chrome.account')}
            icon={<UserIcon />}
            pathname={pathname}
            compact={compact}
          />
        </ul>
      </nav>
    </aside>
  )
}
