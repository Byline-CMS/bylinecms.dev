/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { type ReactNode, useState } from 'react'

import { ChevronDownIcon, GripperVerticalIcon } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useSortable } from '../dnd/draggable-sortable'
import { DraggableContextMenu } from './draggable-context-menu'
import styles from './sortable-item.module.css'

export const SortableItem = ({
  id,
  label,
  children,
  onAddBelow,
  onRemove,
}: {
  id: string
  label: ReactNode
  children: ReactNode
  onAddBelow?: () => void
  onRemove?: () => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  const [collapsed, setCollapsed] = useState(false)

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(
        'byline-sortable',
        styles.root,
        isDragging && ['byline-sortable-dragging', styles.dragging],
        collapsed && ['byline-sortable-collapsed', styles.collapsed]
      )}
    >
      <div
        className={cx(
          'byline-sortable-header',
          styles.header,
          !collapsed && ['byline-sortable-header-expanded', styles['header-expanded']]
        )}
      >
        <button
          type="button"
          className={cx('byline-sortable-grip', styles.grip)}
          {...attributes}
          {...listeners}
        >
          <GripperVerticalIcon className={cx('byline-sortable-grip-icon', styles['grip-icon'])} />
        </button>
        <div className={cx('byline-sortable-label', styles.label)}>{label}</div>
        <DraggableContextMenu onAddBelow={onAddBelow} onRemove={onRemove} />
        <button
          type="button"
          className={cx('byline-sortable-toggle', styles.toggle)}
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand item' : 'Collapse item'}
        >
          <ChevronDownIcon
            className={cx(
              'byline-sortable-toggle-icon',
              styles['toggle-icon'],
              collapsed && ['byline-sortable-toggle-icon-rotated', styles['toggle-icon-rotated']]
            )}
          />
        </button>
      </div>
      <div
        className={cx(
          'byline-sortable-content',
          styles.content,
          collapsed && ['byline-sortable-content-hidden', styles['content-hidden']]
        )}
      >
        {children}
      </div>
    </div>
  )
}
