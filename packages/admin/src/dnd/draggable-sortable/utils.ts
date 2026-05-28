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

export function moveItem(items: any[], moveFromIndex: number, moveToIndex: number) {
  if (
    moveFromIndex < 0 ||
    moveFromIndex >= items.length ||
    moveToIndex < 0 ||
    moveToIndex >= items.length
  ) {
    throw new Error('Index out of bounds')
  }

  const updatedItems = [...items] // Create a copy of the original array
  const [itemToMove] = updatedItems.splice(moveFromIndex, 1)
  updatedItems.splice(moveToIndex, 0, itemToMove)

  return updatedItems
}
