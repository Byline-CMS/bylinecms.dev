'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { HorizontalRuleExtension as LexicalHorizontalRuleExtension } from '@lexical/extension'
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode'
import { declarePeerDependency, defineExtension } from 'lexical'

import { useToolbarActiveEditor } from '../../plugins/toolbar-plugin/toolbar-active-editor'
import { DropDownItem } from '../../ui/dropdown'
import {
  type BylineToolbarConfig,
  BylineToolbarExtension,
} from '../byline-toolbar/byline-toolbar-extension'

function HorizontalRuleInsertItem(): React.JSX.Element {
  const editor = useToolbarActiveEditor()
  return (
    <DropDownItem
      onClick={() => {
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
      }}
      className="item"
    >
      <i className="icon horizontal-rule" />
      <span className="text">Horizontal Rule</span>
    </DropDownItem>
  )
}

/**
 * Byline wrapper around the upstream `HorizontalRuleExtension`. Adds a
 * single insert-menu contribution; the underlying extension still owns
 * the node registration and command behaviour.
 */
export const HorizontalRuleExtension = defineExtension({
  name: '@byline/richtext-lexical/HorizontalRule',
  dependencies: [LexicalHorizontalRuleExtension],
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/HorizontalRule/insert',
          placement: 'insert-menu',
          order: 10,
          node: <HorizontalRuleInsertItem />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
  ],
})
