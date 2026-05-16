/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'

import { defineExtension, safeCast, shallowMergeConfig } from 'lexical'

/**
 * Where in the Byline toolbar a contributed item is rendered. Built-in
 * extensions and third-party extensions both contribute against these
 * placements via `peerDependencies`; the toolbar plugin reads the merged
 * list and dispatches by `placement`.
 *
 * - `'toolbar'` — appended to the end of the main toolbar row.
 * - `'insert-menu'` — listed inside the "Insert" dropdown that the
 *   toolbar shows when at least one insert-menu contribution exists.
 */
export type BylineToolbarPlacement = 'toolbar' | 'insert-menu'

export interface BylineToolbarItem {
  /**
   * Stable identifier — used as React key and for de-duplication.
   * Convention: `<extension-name>/<purpose>`, e.g.
   * `'@byline/richtext-lexical/InlineImage/insert'`.
   */
  id: string
  placement: BylineToolbarPlacement
  /** Sort key within `placement`. Lower numbers render first. */
  order?: number
  node: React.ReactNode
}

export interface BylineToolbarConfig {
  items: BylineToolbarItem[]
}

/**
 * The toolbar contract. Other extensions add toolbar entries by listing
 * `BylineToolbarExtension` in their `peerDependencies` and supplying an
 * `items` array — the configs are merged across every contributor and
 * read once by the toolbar plugin.
 *
 * @example
 * ```ts
 * import { declarePeerDependency, defineExtension } from 'lexical'
 * import { BylineToolbarExtension } from '@byline/richtext-lexical'
 *
 * export const MyExtension = defineExtension({
 *   name: '@example/MyExtension',
 *   peerDependencies: [
 *     declarePeerDependency<typeof BylineToolbarExtension>(
 *       BylineToolbarExtension.name,
 *       {
 *         items: [{
 *           id: '@example/MyExtension/insert',
 *           placement: 'insert-menu',
 *           order: 100,
 *           node: <MyInsertMenuItem />,
 *         }],
 *       }
 *     ),
 *   ],
 * })
 * ```
 */
export const BylineToolbarExtension = defineExtension({
  name: '@byline/richtext-lexical/Toolbar',
  config: safeCast<BylineToolbarConfig>({ items: [] }),
  mergeConfig(a, b) {
    const merged = shallowMergeConfig(a, b)
    if (b.items && b.items.length > 0) {
      merged.items = [...a.items, ...b.items]
    }
    return merged
  },
})

/**
 * Sort and filter helper used by `toolbar-plugin` and any external
 * surface that wants to render Byline toolbar contributions itself.
 */
export function selectToolbarItems(
  items: ReadonlyArray<BylineToolbarItem>,
  placement: BylineToolbarPlacement
): BylineToolbarItem[] {
  return items
    .filter((item) => item.placement === placement)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
