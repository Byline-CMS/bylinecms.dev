/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from '@byline/core'

import { repeatingItemPath } from '../repeating-items'
import type { TargetRole } from './editor-view-state'

/** The working-target address a structural action records (spec §5.4). */
export interface StructuralTarget {
  path: string
  role: TargetRole
}

const STRUCTURAL_TYPES = new Set(['array', 'blocks'])

/** The first value field under `base`, descending into groups. */
function firstFieldPath(base: string, fields: readonly Field[]): string | null {
  const first = fields[0]
  if (first == null || !('name' in first)) return null
  const path = `${base}.${first.name}`
  if (first.type === 'group') return firstFieldPath(path, first.fields ?? [])
  return STRUCTURAL_TYPES.has(first.type) ? null : path
}

/** Adding an item: the new item's first field, otherwise its header. */
export function addedItemTarget(itemPath: string, fields: readonly Field[]): StructuralTarget {
  const field = firstFieldPath(itemPath, fields)
  return field ? { path: field, role: 'field' } : { path: itemPath, role: 'toggle' }
}

/**
 * Removing the item at `index` of `items` (the list before removal): the
 * next item's header, otherwise the previous item's, otherwise the parent
 * field's add control.
 */
export function removedItemTarget(
  parentPath: string,
  items: readonly unknown[],
  index: number
): StructuralTarget {
  const next = items[index + 1]
  if (next !== undefined)
    return { path: repeatingItemPath(parentPath, next, index), role: 'toggle' }
  const previous = items[index - 1]
  if (index > 0 && previous !== undefined) {
    return { path: repeatingItemPath(parentPath, previous, index - 1), role: 'toggle' }
  }
  return { path: parentPath, role: 'action:add' }
}

/** Reordering: the moved item's grip. */
export function movedItemTarget(
  parentPath: string,
  item: unknown,
  toIndex: number
): StructuralTarget {
  return { path: repeatingItemPath(parentPath, item, toIndex), role: 'grip' }
}
