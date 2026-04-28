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

import type { HTMLAttributes } from 'react'

import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'

export type UseDraggableSortableReturn = {
  attributes: HTMLAttributes<unknown>
  isDragging?: boolean
  listeners: SyntheticListenerMap
  setNodeRef: (node: HTMLElement | null) => void
  transform: string
  transition: string
}
