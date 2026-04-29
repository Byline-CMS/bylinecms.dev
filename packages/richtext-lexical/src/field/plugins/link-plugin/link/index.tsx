'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 */

import { useEffect } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
} from 'lexical'

import {
  $toggleLink,
  type LinkAttributes,
  LinkNode,
  TOGGLE_LINK_COMMAND,
} from '../../../nodes/link-nodes'
import { validateUrl } from '../../../utils/url'

export function LinkPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([LinkNode])) {
      throw new Error('LinkPlugin: LinkNode not registered on editor')
    }

    return mergeRegister(
      editor.registerCommand(
        TOGGLE_LINK_COMMAND,
        (payload: LinkAttributes | null) => {
          if (payload === null) {
            $toggleLink(payload)
            return true
          }

          // For custom links, accept either a fully-formed URL or a
          // root-relative path (starts with `/`). Drop the command when the
          // URL is unusable so the toolbar doesn't insert garbage.
          if (payload.linkType === 'custom') {
            const url = payload.url ?? ''
            if (!url.startsWith('/') && !validateUrl(url)) {
              return false
            }
          }

          $toggleLink(payload)
          return true
        },
        COMMAND_PRIORITY_LOW
      ),

      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const selection = $getSelection()
          if (
            !$isRangeSelection(selection) ||
            selection.isCollapsed() ||
            !(event instanceof ClipboardEvent) ||
            event.clipboardData == null
          ) {
            return false
          }
          const clipboardText = event.clipboardData.getData('text')
          if (!validateUrl(clipboardText)) {
            return false
          }
          // Don't auto-link when the selection spans block-level nodes.
          if (selection.getNodes().some((node) => $isElementNode(node))) {
            return false
          }
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, {
            linkType: 'custom',
            url: clipboardText,
          })
          event.preventDefault()
          return true
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor])

  return null
}
