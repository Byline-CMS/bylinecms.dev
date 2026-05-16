'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { TableExtension as LexicalTableExtension } from '@lexical/table'
import { configExtension, declarePeerDependency, defineExtension } from 'lexical'

import { OPEN_TABLE_MODAL_COMMAND } from '../../plugins/table-plugin'
import { useToolbarActiveEditor } from '../../plugins/toolbar-plugin/toolbar-active-editor'
import { DropDownItem } from '../../ui/dropdown'
import {
  type BylineFloatingUIConfig,
  BylineFloatingUIExtension,
} from '../byline-floating-ui/byline-floating-ui-extension'
import {
  type BylineToolbarConfig,
  BylineToolbarExtension,
} from '../byline-toolbar/byline-toolbar-extension'
import { TableActionMenuPlugin } from './table-action-menu-plugin'

function TableInsertItem(): React.JSX.Element {
  const editor = useToolbarActiveEditor()
  return (
    <DropDownItem
      onClick={() => {
        editor.dispatchCommand(OPEN_TABLE_MODAL_COMMAND, null)
      }}
      className="item"
    >
      <i className="icon table" />
      <span className="text">Table</span>
    </DropDownItem>
  )
}

/**
 * Byline wrapper around `@lexical/table`'s `TableExtension`. Forwards
 * cell-merge / cell-background-color config to the upstream extension
 * via `configExtension` and contributes the "Insert table" toolbar item.
 *
 * Override the upstream config with:
 * ```ts
 * lexicalEditor((c) => {
 *   c.extensions.configure(LexicalTableExtension, {
 *     hasCellMerge: false,
 *     hasCellBackgroundColor: false,
 *   })
 *   return c
 * })
 * ```
 */
export const TableExtension = defineExtension({
  name: '@byline/richtext-lexical/Table',
  dependencies: [
    configExtension(LexicalTableExtension, {
      hasCellMerge: true,
      hasCellBackgroundColor: true,
    }),
  ],
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/Table/insert',
          placement: 'insert-menu',
          order: 50,
          node: <TableInsertItem />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
    declarePeerDependency<typeof BylineFloatingUIExtension>(BylineFloatingUIExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/Table/action-menu',
          Component: TableActionMenuPlugin,
        },
      ],
    } satisfies Partial<BylineFloatingUIConfig>),
  ],
})
