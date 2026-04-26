import { IconButton, Tooltip } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useAdminMenu } from './menu-provider.tsx'

export function DrawerToggle() {
  const { toggleDrawer, drawerOpen } = useAdminMenu()

  return (
    <div
      className={cx('fixed top-[38px] z-50 transition-all duration-300 ease-in-out', {
        'left-[8px]': !drawerOpen,
        'left-[160px]': drawerOpen,
      })}
    >
      <Tooltip
        text={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        side="right"
        sideOffset={8}
      >
        <IconButton
          type="button"
          className="outline-none min-w-[42px] h-[36px]"
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
