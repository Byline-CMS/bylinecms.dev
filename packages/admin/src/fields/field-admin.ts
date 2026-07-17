/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldAdminConfig } from '@byline/core'

// ---------------------------------------------------------------------------
// Field admin map slicing — `fields{}` override maps (CollectionAdminConfig /
// BlockAdminConfig) are keyed by dotted, index-free schema paths relative to
// the map's root ('title', 'faq.answer'). Structural widgets thread the map
// down one level at a time: a child field takes its own entry by exact name,
// and receives the descendant entries re-keyed relative to itself.
// ---------------------------------------------------------------------------

/**
 * Entries of `map` addressing descendants of `childName`, re-keyed with the
 * `childName.` prefix stripped — the sub-map a structural child (group /
 * array) threads to its own children. Returns `undefined` when `map` has no
 * descendant entries for the child, so leaf widgets aren't handed empty maps.
 */
export function sliceFieldAdmin(
  map: Record<string, FieldAdminConfig> | undefined,
  childName: string
): Record<string, FieldAdminConfig> | undefined {
  if (map == null) return undefined
  const prefix = `${childName}.`
  let sliced: Record<string, FieldAdminConfig> | undefined
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      sliced ??= {}
      sliced[key.slice(prefix.length)] = value
    }
  }
  return sliced
}
