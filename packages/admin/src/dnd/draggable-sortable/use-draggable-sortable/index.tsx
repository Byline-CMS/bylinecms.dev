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

import type { UseDraggableArguments } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'

import type { UseDraggableSortableReturn } from './types.js'

export const useDraggableSortable = (props: UseDraggableArguments): UseDraggableSortableReturn => {
  const { id, disabled } = props

  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled,
    transition: {
      duration: 250,
      easing: 'cubic-bezier(0, 0.2, 0.2, 1)',
    },
  })

  return {
    attributes: {
      ...attributes,
      style: {
        cursor: isDragging ? 'grabbing' : 'grab',
        transition,
      },
    },
    isDragging,
    // @ts-expect-error
    listeners,
    setNodeRef,
    // @ts-expect-error
    transform: transform && `translate3d(${transform.x}px, ${transform.y}px, 0)`, // translate3d is faster than translate in most browsers
    //@ts-expect-error
    transition,
  }
}
