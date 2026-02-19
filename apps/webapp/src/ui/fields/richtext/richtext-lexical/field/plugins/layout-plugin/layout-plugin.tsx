'use client'

import * as React from 'react'
import { useEffect } from 'react'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils'
import type { ElementNode, LexicalCommand, LexicalNode, NodeKey } from 'lexical'
import {
  $createParagraphNode,
  $getNodeByKey,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
} from 'lexical'

import {
  $createLayoutContainerNode,
  $isLayoutContainerNode,
  LayoutContainerNode,
} from '../../nodes/layout-container-node/layout-container-node'
import {
  $createLayoutItemNode,
  $isLayoutItemNode,
  LayoutItemNode,
} from '../../nodes/layout-container-node/layout-item-node'
import { InsertLayoutModal } from './insert-layout-modal'

export const OPEN_INSERT_LAYOUT_MODAL_COMMAND = createCommand('OPEN_INSERT_LAYOUT_MODAL_COMMAND')

export const INSERT_LAYOUT_COMMAND: LexicalCommand<string> = createCommand<string>()

export const UPDATE_LAYOUT_COMMAND: LexicalCommand<{
  template: string
  nodeKey: NodeKey
}> = createCommand<{ template: string; nodeKey: NodeKey }>()

export function LayoutPlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = React.useState(false)

  const handleOnClose = (): void => {
    setOpen(false)
  }

  const handleOnSubmit = (layout: string) => {
    if (layout != null) {
      editor.dispatchCommand(INSERT_LAYOUT_COMMAND, layout)
    } else {
      console.error('Error: missing layout for insertion.')
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!editor.hasNodes([LayoutContainerNode, LayoutItemNode])) {
      throw new Error(
        'LayoutPlugin: LayoutContainerNode, or LayoutItemNode not registered on editor'
      )
    }

    return mergeRegister(
      editor.registerCommand<null>(
        OPEN_INSERT_LAYOUT_MODAL_COMMAND,
        () => {
          setOpen(true)
          return true
        },
        COMMAND_PRIORITY_NORMAL
      ),
      editor.registerCommand(
        INSERT_LAYOUT_COMMAND,
        (template) => {
          editor.update(() => {
            const container = $createLayoutContainerNode(template)
            const itemsCount = getItemsCountFromTemplate(template)

            for (let i = 0; i < itemsCount; i++) {
              container.append($createLayoutItemNode().append($createParagraphNode()))
            }

            $insertNodeToNearestRoot(container)
            container.selectStart()
          })

          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        UPDATE_LAYOUT_COMMAND,
        ({ template, nodeKey }) => {
          editor.update(() => {
            const container = $getNodeByKey<LexicalNode>(nodeKey)

            if (!$isLayoutContainerNode(container)) {
              return
            }

            const itemsCount = getItemsCountFromTemplate(template)
            const prevItemsCount = getItemsCountFromTemplate(container.getTemplateColumns())

            // Add or remove extra columns if new template does not match existing one
            if (itemsCount > prevItemsCount) {
              for (let i = prevItemsCount; i < itemsCount; i++) {
                container.append($createLayoutItemNode().append($createParagraphNode()))
              }
            } else if (itemsCount < prevItemsCount) {
              for (let i = prevItemsCount - 1; i >= itemsCount; i--) {
                const layoutItem = container.getChildAtIndex<LexicalNode>(i)

                if ($isLayoutItemNode(layoutItem)) {
                  layoutItem.remove()
                }
              }
            }

            container.setTemplateColumns(template)
          })

          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),
      // Structure enforcing transformers for each node type. In case nesting structure is not
      // "Container > Item" it'll unwrap nodes and convert it back
      // to regular content.
      editor.registerNodeTransform(LayoutItemNode, (node) => {
        const parent = node.getParent<ElementNode>()
        if (!$isLayoutContainerNode(parent)) {
          const children = node.getChildren<LexicalNode>()
          for (const child of children) {
            node.insertBefore(child)
          }
          node.remove()
        }
      }),
      editor.registerNodeTransform(LayoutContainerNode, (node) => {
        const children = node.getChildren<LexicalNode>()
        if (!children.every($isLayoutItemNode)) {
          for (const child of children) {
            node.insertBefore(child)
          }
          node.remove()
        }
      })
    )
  }, [editor])

  return <InsertLayoutModal open={open} onClose={handleOnClose} onSubmit={handleOnSubmit} />
}

function getItemsCountFromTemplate(template: string): number {
  return template.trim().split(/\s+/).length
}
