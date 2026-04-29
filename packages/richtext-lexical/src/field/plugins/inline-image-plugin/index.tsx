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

import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $wrapNodeInElement, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $getNodeByKey,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'

import {
  $createInlineImageNode,
  $isInlineImageNode,
  InlineImageNode,
} from '../../nodes/inline-image-node'
import { InlineImageModal } from './inline-image-modal'
import type { InlineImageAttributes } from '../../nodes/inline-image-node/types'
import type { InlineImageData } from './types'

export type InsertInlineImagePayload = Readonly<InlineImageAttributes>
export type UpdateInlineImagePayload = Readonly<{
  nodeKey: NodeKey
  attributes: InlineImageAttributes
}>
export type OpenInlineImageModalPayload = Readonly<{ nodeKey?: NodeKey }> | null

/**
 * Asks the InlineImagePlugin to open its modal. Pass `null` (or omit
 * `nodeKey`) for insert mode; pass a `nodeKey` to edit an existing node
 * with its current attributes pre-filled.
 */
export const OPEN_INLINE_IMAGE_MODAL_COMMAND: LexicalCommand<OpenInlineImageModalPayload> =
  createCommand('OPEN_INLINE_IMAGE_MODAL_COMMAND')

/** Inserts a new InlineImageNode at the current selection. */
export const INSERT_INLINE_IMAGE_COMMAND: LexicalCommand<InsertInlineImagePayload> = createCommand(
  'INSERT_INLINE_IMAGE_COMMAND'
)

/** Updates the InlineImageNode identified by `nodeKey` in place. */
export const UPDATE_INLINE_IMAGE_COMMAND: LexicalCommand<UpdateInlineImagePayload> = createCommand(
  'UPDATE_INLINE_IMAGE_COMMAND'
)

type ModalMode = 'insert' | 'edit'

interface ModalState {
  mode: ModalMode
  open: boolean
  nodeKey: NodeKey | null
  initialData: InlineImageData | undefined
}

const CLOSED_STATE: ModalState = {
  mode: 'insert',
  open: false,
  nodeKey: null,
  initialData: undefined,
}

/**
 * Build the modal's `initialData` from a live node. Reads via
 * `editor.getEditorState().read(...)` so we don't mutate state during a
 * non-update phase.
 */
function readNodeAsInitialData(
  editor: LexicalEditor,
  nodeKey: NodeKey
): InlineImageData | undefined {
  let data: InlineImageData | undefined
  editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey)
    if (!$isInlineImageNode(node)) return
    data = {
      documentRelation: node.getRelation(),
      src: node.getSrc(),
      altText: node.getAltText(),
      position: node.getPosition(),
      showCaption: node.getShowCaption(),
    }
  })
  return data
}

export function InlineImagePlugin({ collection }: { collection: string }): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [modalState, setModalState] = useState<ModalState>(CLOSED_STATE)

  useEffect(() => {
    if (!editor.hasNodes([InlineImageNode])) {
      throw new Error('InlineImagePlugin: InlineImageNode not registered on editor')
    }

    return mergeRegister(
      editor.registerCommand<OpenInlineImageModalPayload>(
        OPEN_INLINE_IMAGE_MODAL_COMMAND,
        (payload) => {
          const nodeKey = payload?.nodeKey
          if (nodeKey != null) {
            const initialData = readNodeAsInitialData(editor, nodeKey)
            setModalState({ mode: 'edit', open: true, nodeKey, initialData })
          } else {
            setModalState({
              mode: 'insert',
              open: true,
              nodeKey: null,
              initialData: undefined,
            })
          }
          return true
        },
        COMMAND_PRIORITY_NORMAL
      ),

      editor.registerCommand<InsertInlineImagePayload>(
        INSERT_INLINE_IMAGE_COMMAND,
        (payload) => {
          const imageNode = $createInlineImageNode(payload)
          $insertNodes([imageNode])
          if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
            $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd()
          }
          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),

      editor.registerCommand<UpdateInlineImagePayload>(
        UPDATE_INLINE_IMAGE_COMMAND,
        ({ nodeKey, attributes }) => {
          const node = $getNodeByKey(nodeKey)
          if ($isInlineImageNode(node)) {
            node.update(attributes)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  }, [editor])

  const handleSubmit = useCallback(
    (data: InlineImageData) => {
      if (data.documentRelation == null) return

      const attributes: InlineImageAttributes = {
        ...data.documentRelation,
        src: data.src,
        altText: data.altText,
        position: data.position,
        width: data.width,
        height: data.height,
        showCaption: data.showCaption,
      }

      if (modalState.mode === 'edit' && modalState.nodeKey != null) {
        editor.dispatchCommand(UPDATE_INLINE_IMAGE_COMMAND, {
          nodeKey: modalState.nodeKey,
          attributes,
        })
      } else {
        editor.dispatchCommand(INSERT_INLINE_IMAGE_COMMAND, attributes)
      }
    },
    [editor, modalState.mode, modalState.nodeKey]
  )

  const handleClose = useCallback(() => {
    setModalState(CLOSED_STATE)
  }, [])

  return (
    <InlineImageModal
      isOpen={modalState.open}
      collection={collection}
      data={modalState.initialData}
      onSubmit={handleSubmit}
      onClose={handleClose}
    />
  )
}
