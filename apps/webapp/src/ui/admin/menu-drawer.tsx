import type React from 'react'
import { useRouterState } from '@tanstack/react-router'

import { ActivityIcon, EmailIcon, HomeIcon, RolesIcon, UsersIcon } from '@infonomic/uikit/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { LangLink } from '@/i18n/components/lang-link.tsx'
import { pathWithoutLocale } from '@/i18n/utils'
import { useAdminMenu } from './menu-provider.tsx'

import './menu-drawer.css'

const isActive = (currentPath: string, linkHref: string): boolean => {
  // Strip any locale prefix so we match against the canonical path
  const path = pathWithoutLocale(currentPath)

  // Special case for root admin path to prevent highlighting when in subpaths
  if (linkHref === '/admin') {
    return path === '/admin'
  }

  // For all other paths, use startsWith to check if current path starts with linkHref
  return path.startsWith(linkHref)
}

export function AdminMenuDrawer(): React.JSX.Element | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { drawerOpen, closeDrawer } = useAdminMenu()

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      closeDrawer()
    },
  })

  return (
    <aside
      id="admin-menu"
      className={cx(
        'w-[220px]',
        'border-r border-b bg-canvas-25 dark:border-canvas-800 dark:bg-canvas-800',
        'z-[15] transition-all duration-300 ease-in-out',
        drawerOpen === true ? 'transform-none' : '-translate-x-[220px]'
      )}
      {...handlers}
    >
      <nav className="admin-menu-drawer">
        <ul>
          <li className={cx({ active: isActive(pathname, '/admin') }, 'menu-item')}>
            <LangLink to="/admin">
              <span className="icon">
                <HomeIcon />
              </span>
              <span>Admin Home</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/users') }, 'menu-item')}>
            <LangLink to="/admin/users">
              <span className="icon">
                <UsersIcon />
              </span>
              <span>Users</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/messages') }, 'menu-item')}>
            <LangLink to="/admin/messages">
              <span className="icon">
                <EmailIcon />
              </span>
              <span>Messages</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/activities') }, 'menu-item')}>
            <LangLink to="/admin/activities">
              <span className="icon">
                <ActivityIcon width="20px" height="20px" />
              </span>
              <span>Activities</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/activity-types') }, 'menu-item')}>
            <LangLink to="/admin/activity-types">
              <span className="icon">
                <ActivityIcon width="20px" height="20px" />
              </span>
              <span>Activity Types</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/roles') }, 'menu-item')}>
            <LangLink to="/admin/roles">
              <span className="icon">
                <RolesIcon height="25px" width="25px" />
              </span>
              <span>Roles</span>
            </LangLink>
          </li>
          <li className="menu-separator" />
          <li className={cx({ active: isActive(pathname, '/admin/admin-users') }, 'menu-item')}>
            <LangLink to="/admin/admin-users">
              <span className="icon">
                <UsersIcon />
              </span>
              <span>Admin Users</span>
            </LangLink>
          </li>
          <li className={cx({ active: isActive(pathname, '/admin/admin-roles') }, 'menu-item')}>
            <LangLink to="/admin/admin-roles">
              <span className="icon">
                <RolesIcon height="25px" width="25px" />
              </span>
              <span>Admin Roles</span>
            </LangLink>
          </li>
        </ul>
      </nav>
    </aside>
  )
}
