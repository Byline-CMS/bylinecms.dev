/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 */

import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  defineExtension,
  type LexicalCommand,
} from 'lexical'

import { $createVimeoNode, VimeoNode } from '../../nodes/vimeo-node'

export const INSERT_VIMEO_COMMAND: LexicalCommand<string> = createCommand('INSERT_VIMEO_COMMAND')

export const VimeoExtension = defineExtension({
  name: '@byline/richtext-lexical/Vimeo',
  nodes: () => [VimeoNode],
  register: (editor) =>
    editor.registerCommand<string>(
      INSERT_VIMEO_COMMAND,
      (payload) => {
        const vimeoNode = $createVimeoNode(payload)
        $insertNodeToNearestRoot(vimeoNode)
        return true
      },
      COMMAND_PRIORITY_EDITOR
    ),
})
