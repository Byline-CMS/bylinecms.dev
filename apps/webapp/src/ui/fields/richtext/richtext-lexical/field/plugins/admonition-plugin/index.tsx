'use client'

/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import * as React from 'react'
import { useEffect } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
} from 'lexical'

import { $createAdmonitionNode, AdmonitionNode } from '../../nodes/admonition-node'
import { AdmonitionModal } from './admonition-modal'
import type { AdmonitionAttributes } from '../../nodes/admonition-node/types'
import type { AdmonitionData } from './types'

export type InsertAdmonitionPayload = Readonly<AdmonitionAttributes>

export const OPEN_ADMONITION_MODAL_COMMAND: LexicalCommand<null> = createCommand(
  'OPEN_ADMONITION_MODAL_COMMAND'
)

export const INSERT_ADMONITION_COMMAND: LexicalCommand<AdmonitionAttributes> = createCommand(
  'INSERT_ADMONITION_COMMAND'
)

export function AdmonitionPlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = React.useState(false)

  useEffect(() => {
    if (!editor.hasNodes([AdmonitionNode])) {
      throw new Error('AdmonitionPlugin: AdmonitionNode not registered on editor')
    }

    return mergeRegister(
      // TODO: possibly register this command with insert and edit options?
      editor.registerCommand<null>(
        OPEN_ADMONITION_MODAL_COMMAND,
        () => {
          setOpen(true)
          return true
        },
        COMMAND_PRIORITY_NORMAL
      ),

      editor.registerCommand<InsertAdmonitionPayload>(
        INSERT_ADMONITION_COMMAND,
        (payload: AdmonitionAttributes) => {
          // return true
          const selection = $getSelection()

          if (!$isRangeSelection(selection)) {
            return false
          }

          const focusNode = selection.focus.getNode()

          if (focusNode !== null) {
            const admonitionNode = $createAdmonitionNode(payload)
            $insertNodeToNearestRoot(admonitionNode)
          }
          return true
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  }, [editor])

  const handleInsertAdmonition = ({ admonitionType, title }: AdmonitionData): void => {
    if (title != null && admonitionType != null) {
      const admonitionPayload: AdmonitionAttributes = {
        admonitionType,
        title,
      }

      editor.dispatchCommand(INSERT_ADMONITION_COMMAND, admonitionPayload)
    } else {
      console.error('Error: missing title or type for admonition.')
    }
    setOpen(false)
  }

  return (
    <AdmonitionModal
      open={open}
      data={{ title: '', admonitionType: undefined }}
      onClose={() => setOpen(false)}
      onSubmit={handleInsertAdmonition}
    />
  )
}
