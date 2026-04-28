'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { useEffect } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import { COMMAND_PRIORITY_EDITOR, createCommand, type LexicalCommand } from 'lexical'

import { $createVimeoNode, VimeoNode } from '../../nodes/vimeo-node'

export const INSERT_VIMEO_COMMAND: LexicalCommand<string> = createCommand('INSERT_VIMEO_COMMAND')

export function VimeoPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([VimeoNode])) {
      throw new Error('VimeoPlugin: VimeoNode not registered on editor')
    }

    return editor.registerCommand<string>(
      INSERT_VIMEO_COMMAND,
      (payload) => {
        const vimeoNode = $createVimeoNode(payload)
        $insertNodeToNearestRoot(vimeoNode)

        return true
      },
      COMMAND_PRIORITY_EDITOR
    )
  }, [editor])

  return null
}
