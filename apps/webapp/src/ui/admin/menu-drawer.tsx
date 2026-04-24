/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type React from 'react'
import { useRouterState } from '@tanstack/react-router'

import {
  ChevronDownIcon,
  HomeIcon,
  IconButton,
  RolesIcon,
  SettingsSlidersIcon,
  UserIcon,
  UsersIcon,
} from '@infonomic/uikit/react'
import cx from 'classnames'
import { useSwipeable } from 'react-swipeable'

import { LangLink } from '@/i18n/components/lang-link.tsx'
import { pathWithoutLocale } from '@/i18n/utils'
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

/**
 * Single toggle button, reused by both the drawer-edge and the mobile
 * floating-launcher render sites. Kept free of positioning so the two
 * parents can position it however each case needs; `aria-controls` is
 * the anchor `content.tsx` uses to exempt clicks from its close-on-
 * outside-click listener.
 */
function ToggleButton({ drawerOpen, onClick }: { drawerOpen: boolean; onClick: () => void }) {
  return (
    <IconButton
      variant="filled"
      intent="noeffect"
      size="sm"
      onClick={onClick}
      aria-label={drawerOpen ? 'Collapse admin menu' : 'Expand admin menu'}
      aria-controls="admin-menu"
    >
      <ChevronDownIcon
        className={cx('transition-transform duration-300 ease-in-out', {
          'rotate-90': drawerOpen === true,
          'rotate-270': drawerOpen === false,
        })}
      />
    </IconButton>
  )
}

/**
 * Admin left-nav drawer.
 *
 * Two-axis behaviour:
 *
 *   - **Desktop, open** — inline flex column, 210px wide, icons + labels.
 *   - **Desktop, closed** — inline flex column, 70px wide, icons only
 *     (menu items apply `.compact` to hide labels and centre the icon).
 *     Desktop never fully hides; the narrow column stays as a persistent
 *     launcher.
 *   - **Mobile, open** — `position: fixed` overlay below the app bar,
 *     full 210px width with labels. Taps outside close it (see
 *     `content.tsx`).
 *   - **Mobile, closed** — hidden entirely. A small floating chevron
 *     button at the top-left of the viewport is the re-open affordance
 *     (the drawer's own edge chevron is off-screen in this state).
 *
 * The edge chevron inside the aside toggles the drawer and rotates to
 * indicate direction. Routes that want the drawer closed by default
 * (currently `/admin/collections/*`) drive that through the provider —
 * see `menu-provider.tsx`.
 */
export function AdminMenuDrawer(): React.JSX.Element | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { mobile, drawerOpen, toggleDrawer, closeDrawer } = useAdminMenu()

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
  // aside is translated off-screen.
  const mobileToggle =
    mobile === true ? (
      <div
        className={cx(
          'fixed top-[60px] z-50 transition-[left] duration-300 ease-in-out',
          drawerOpen === true ? 'left-[186px]' : 'left-2'
        )}
      >
        <ToggleButton drawerOpen={drawerOpen} onClick={toggleDrawer} />
      </div>
    ) : null

  return (
    <>
      {mobileToggle}
      <aside
        id="admin-menu"
        className={cx(
          'flex flex-col',
          'border-r border-canvas-200 bg-canvas-25 dark:border-canvas-800 dark:bg-canvas-800',
          'z-[15] transition-all duration-300 ease-in-out',
          // Mobile: `fixed` overlay below the app bar, taken out of flow so
          // the content area does not move when the drawer opens. The
          // aside is always mounted; transform slides it in / out.
          mobile === true && 'fixed top-[45px] bottom-0 left-0 w-[210px]',
          mobile === true && (drawerOpen === true ? 'translate-x-0' : '-translate-x-full'),
          // Desktop: inline flex column, width toggles 210 (labels) vs 70
          // (icons only). `relative` positions the edge toggle against the
          // aside; the two position classes can't coexist so we pick one
          // per branch.
          mobile === false && 'relative self-stretch flex-shrink-0',
          mobile === false && (drawerOpen === true ? 'w-[210px]' : 'w-[70px]')
        )}
        {...handlers}
      >
        {/* Edge chevron — desktop only. Mobile uses the floating toggle
            above so the drawer slide doesn't expose a second chevron. */}
        {mobile === false && (
          <div className="absolute top-[20px] -right-3 z-50">
            <ToggleButton drawerOpen={drawerOpen} onClick={toggleDrawer} />
          </div>
        )}
        <nav className="admin-menu-drawer">
          <ul>
            <MenuItem
              to="/admin"
              label="Dashboard"
              icon={<HomeIcon />}
              pathname={pathname}
              compact={compact}
            />
            <li className="menu-separator" />
            <MenuItem
              to="/admin/users"
              label="Admin Users"
              icon={<UsersIcon />}
              pathname={pathname}
              compact={compact}
            />
            <MenuItem
              to="/admin/roles"
              label="Admin Roles"
              icon={<RolesIcon height="25px" width="25px" />}
              pathname={pathname}
              compact={compact}
            />
            <MenuItem
              to="/admin/permissions"
              label="Permissions"
              icon={<SettingsSlidersIcon />}
              pathname={pathname}
              compact={compact}
            />
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
    </>
  )
}
