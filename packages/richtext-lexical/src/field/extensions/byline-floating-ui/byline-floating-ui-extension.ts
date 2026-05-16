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
 * Props passed by `Editor.tsx` to every registered floating-UI component.
 * The component renders itself (usually via `createPortal(..., anchorElem)`)
 * inside the editor's floating slot.
 */
export interface BylineFloatingUIProps {
  anchorElem: HTMLElement
}

export interface BylineFloatingUIItem {
  /**
   * Stable identifier — used as React key and for de-duplication.
   * Convention: `<extension-name>/<purpose>`, e.g.
   * `'@byline/richtext-lexical/Link/floating-editor'`.
   */
  id: string
  /**
   * The floating UI component. Receives `anchorElem` (the editor's
   * inner content-editable wrapper) as a prop and is expected to portal
   * itself into that element.
   */
  Component: React.ComponentType<BylineFloatingUIProps>
  /** Sort key — lower numbers render first. Mostly cosmetic. */
  order?: number
}

export interface BylineFloatingUIConfig {
  items: BylineFloatingUIItem[]
}

/**
 * The floating-UI contract. Other extensions contribute floating UIs by
 * listing `BylineFloatingUIExtension` in their `peerDependencies` and
 * supplying an `items` array. The editor's floating slot reads the merged
 * list once and renders every contributor under the shared anchor.
 *
 * Mirror of `BylineToolbarExtension` for the floating-UI surface — same
 * pattern, same authoring shape.
 *
 * @example
 * ```ts
 * import { declarePeerDependency, defineExtension } from 'lexical'
 * import { BylineFloatingUIExtension } from '@byline/richtext-lexical'
 *
 * export const MyExtension = defineExtension({
 *   name: '@example/MyExtension',
 *   peerDependencies: [
 *     declarePeerDependency<typeof BylineFloatingUIExtension>(
 *       BylineFloatingUIExtension.name,
 *       {
 *         items: [{
 *           id: '@example/MyExtension/floating',
 *           Component: MyFloatingPopover,
 *         }],
 *       }
 *     ),
 *   ],
 * })
 * ```
 */
export const BylineFloatingUIExtension = defineExtension({
  name: '@byline/richtext-lexical/FloatingUI',
  config: safeCast<BylineFloatingUIConfig>({ items: [] }),
  mergeConfig(a, b) {
    const merged = shallowMergeConfig(a, b)
    if (b.items && b.items.length > 0) {
      merged.items = [...a.items, ...b.items]
    }
    return merged
  },
})

/** Sort helper used by the editor's floating-UI slot. */
export function selectFloatingUIItems(
  items: ReadonlyArray<BylineFloatingUIItem>
): BylineFloatingUIItem[] {
  return items.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}
