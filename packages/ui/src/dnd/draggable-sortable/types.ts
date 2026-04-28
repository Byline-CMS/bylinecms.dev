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

import type { Ref } from 'react'

import type { DragEndEvent } from '@dnd-kit/core'

export type Props = {
  children: React.ReactNode
  className?: string
  droppableRef?: Ref<HTMLElement>
  ids: string[]
  onDragEnd: (e: { event: DragEndEvent; moveFromIndex: number; moveToIndex: number }) => void
}
