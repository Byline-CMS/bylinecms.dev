'use client'

import {
  DeleteIcon,
  Dropdown as DropdownMenu,
  EllipsisIcon,
  IconButton,
  PlusIcon,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import type { Locale } from '@/i18n/i18n-config'

const menuItemClasses = cx(
  'flex gap-1 w-full rounded px-[2px] py-[5px] md:text-sm',
  'hover:bg-canvas-50/30 dark:hover:bg-canvas-900',
  'cursor-default select-none items-center outline-none',
  'text-gray-600 focus:bg-canvas-50/30 dark:text-gray-300 dark:focus:bg-canvas-900'
)

interface DraggableContextMenuProps {
  lng: Locale
  onAddBelow?: () => void
  onRemove?: () => void
}

export function DraggableContextMenu({ lng, onAddBelow, onRemove }: DraggableContextMenuProps): React.JSX.Element {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton variant="text" size="sm">
          <EllipsisIcon width="16px" height="16px" />
        </IconButton>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={0}
          className={cx(
            'z-40 rounded radix-side-bottom:animate-slide-down radix-side-top:animate-slide-up',
            'w-34 px-1.5 py-1 shadow-md',
            'bg-white dark:bg-canvas-800 border dark:border-canvas-700 shadow'
          )}
        >
          <DropdownMenu.Item className={menuItemClasses} onSelect={onAddBelow}>
            <div
              className="flex w-full items-center gap-1"
            >
              <span className="inline-block w-[22px]">
                <PlusIcon width="18px" height="18px" />
              </span>
              <span className="text-left inline-block w-full flex-1 self-start text-black dark:text-gray-300">
                Add Below
              </span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 border-t border-t-gray-200 dark:border-t-gray-900 w-[90%] mx-auto" />
          <DropdownMenu.Item className={menuItemClasses} onSelect={onRemove}>
            <div
              className="flex w-full items-center gap-1"
            >
              <div className="flex items-center gap-1">
                <span className="inline-block w-[22px]">
                  <DeleteIcon
                    width="18px"
                    height="18px"
                    svgClassName="stroke-red-600 dark:stroke-red-600"
                  />
                </span>
                <span className="text-left inline-block w-full flex-1 self-start text-red-600">
                  Remove
                </span>
              </div>
            </div>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
