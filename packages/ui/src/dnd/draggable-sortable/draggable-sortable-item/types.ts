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

import type { UseDraggableArguments } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'

import type { UseDraggableSortableReturn } from '../use-draggable-sortable/types.js'

export type DragHandleProps = {
  attributes: UseDraggableArguments['attributes']
  listeners: SyntheticListenerMap
} & UseDraggableArguments

export type ChildFunction = (args: UseDraggableSortableReturn) => React.ReactNode

export type Props = {
  children: ChildFunction
} & UseDraggableArguments
