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

import { useSortable } from '@/ui/dnd/draggable-sortable'
import { DraggableContextMenu } from './draggable-context-menu'

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
      className={cx('p-4 pt-2 border border-dashed border-gray-600 rounded-md', {
        'shadow-sm bg-canvas-50/50 dark:bg-canvas-800': !isDragging,
        'shadow-md bg-canvas-50/80 dark:bg-canvas-700/30': isDragging,
        'pt-2 pb-2': collapsed,
      })}
    >
      <div className={cx('flex items-center gap-2 mb-0 -ml-3', { 'mb-2': !collapsed })}>
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400 flex items-center justify-center"
          {...attributes}
          {...listeners}
        >
          <GripperVerticalIcon className="w-4 h-4 text-primary-500 dark:text-primary-200" />
        </button>
        <div className="text-[1rem] font-medium flex-1 min-w-0 truncate">{label}</div>
        <DraggableContextMenu lng="en" onAddBelow={onAddBelow} onRemove={onRemove} />
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-800 text-gray-400 flex items-center justify-center"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand item' : 'Collapse item'}
        >
          <ChevronDownIcon
            className={cx('w-4 h-4 transition-transform', {
              'rotate-180': collapsed,
            })}
          />
        </button>
      </div>
      <div
        className={cx('flex flex-col relative gap-4 transition-all duration-200', {
          'max-h-0 opacity-0 -z-10': collapsed,
          'opacity-100': !collapsed,
        })}
      >
        {children}
      </div>
    </div>
  )
}
