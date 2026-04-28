'use client'

/**
 *
 * Copyright (c) Payload CMS, LLC info@payloadcms.com
 * Copyright notices appear at the top of source files where applicable
 * and are licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree
 *
 * https://github.com/payloadcms/payload/*
 *
 * Based on https://docs.dndkit.com/presets/sortable#connecting-all-the-pieces
 *
 */

import type React from 'react'
import { useCallback, useId } from 'react'

import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import type { Props } from './types.js'

export type { Props }

export const DraggableSortable: React.FC<Props> = (props) => {
  const { children, className, ids, onDragEnd } = props

  const id = useId()

  const { setNodeRef } = useDroppable({
    id,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (!active || !over) return

      if (typeof onDragEnd === 'function') {
        onDragEnd({
          event,
          moveFromIndex: ids.indexOf(String(active.id)),
          moveToIndex: ids.indexOf(String(over.id)),
        })
      }
    },
    [onDragEnd, ids]
  )

  return (
    <DndContext
      collisionDetection={closestCenter}
      id={id}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext items={ids}>
        <div className={className} ref={setNodeRef}>
          {children}
        </div>
      </SortableContext>
    </DndContext>
  )
}
