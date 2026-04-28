'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  DeleteIcon,
  Dropdown as DropdownMenu,
  EllipsisIcon,
  IconButton,
  PlusIcon,
} from '@infonomic/uikit/react'
import cx from 'classnames'

import styles from './draggable-context-menu.module.css'

interface DraggableContextMenuProps {
  onAddBelow?: () => void
  onRemove?: () => void
}

export function DraggableContextMenu({
  onAddBelow,
  onRemove,
}: DraggableContextMenuProps): React.JSX.Element {
  const itemClass = cx('byline-draggable-menu-item', styles.item)
  const rowClass = cx('byline-draggable-menu-row', styles.row)
  const iconSlotClass = cx('byline-draggable-menu-icon-slot', styles['icon-slot'])
  const labelClass = cx('byline-draggable-menu-label', styles.label)

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger render={<IconButton variant="text" size="sm" />}>
        <EllipsisIcon width="16px" height="16px" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={0}
          className={cx('byline-draggable-menu', styles.menu)}
        >
          <DropdownMenu.Item className={itemClass} onClick={onAddBelow}>
            <div className={rowClass}>
              <span className={iconSlotClass}>
                <PlusIcon width="18px" height="18px" />
              </span>
              <span className={labelClass}>Add Below</span>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Separator
            className={cx('byline-draggable-menu-separator', styles.separator)}
          />
          <DropdownMenu.Item className={itemClass} onClick={onRemove}>
            <div className={rowClass}>
              <div className={rowClass}>
                <span className={iconSlotClass}>
                  <DeleteIcon
                    width="18px"
                    height="18px"
                    svgClassName={cx('byline-draggable-menu-delete-icon', styles['delete-icon'])}
                  />
                </span>
                <span
                  className={cx(
                    'byline-draggable-menu-label byline-draggable-menu-label-danger',
                    styles.label,
                    styles['label-danger']
                  )}
                >
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
