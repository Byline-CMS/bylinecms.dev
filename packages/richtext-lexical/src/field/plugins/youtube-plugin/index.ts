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

import { $createYouTubeNode, YouTubeNode } from '../../nodes/youtube-node'

export const INSERT_YOUTUBE_COMMAND: LexicalCommand<string> =
  createCommand('INSERT_YOUTUBE_COMMAND')

export const YouTubeExtension = defineExtension({
  name: '@byline/richtext-lexical/YouTube',
  nodes: () => [YouTubeNode],
  register: (editor) =>
    editor.registerCommand<string>(
      INSERT_YOUTUBE_COMMAND,
      (payload) => {
        const youTubeNode = $createYouTubeNode(payload)
        $insertNodeToNearestRoot(youTubeNode)
        return true
      },
      COMMAND_PRIORITY_EDITOR
    ),
})
