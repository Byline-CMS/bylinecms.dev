'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import * as React from 'react'
import { useEffect } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ReactExtension } from '@lexical/react/ReactExtension'
import { useOptionalExtensionDependency } from '@lexical/react/useExtensionComponent'
import { $findMatchingParent, $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils'
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  configExtension,
  declarePeerDependency,
  defineExtension,
  type ElementNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type NodeKey,
} from 'lexical'

import { useToolbarActiveEditor } from '../../plugins/toolbar-plugin/toolbar-active-editor'
import { DropDownItem } from '../../ui/dropdown'
import {
  type BylineFloatingUIConfig,
  BylineFloatingUIExtension,
  type BylineFloatingUIProps,
} from '../byline-floating-ui/byline-floating-ui-extension'
import {
  type BylineToolbarConfig,
  BylineToolbarExtension,
} from '../byline-toolbar/byline-toolbar-extension'
import { FloatingTextFormatExtension } from '../floating-text-format/floating-text-format-extension'
import { FloatingTextFormatToolbarPlugin } from '../floating-text-format/index'
import { INSERT_ADMONITION_COMMAND, OPEN_ADMONITION_MODAL_COMMAND } from './admonition-commands'
import { AdmonitionModal } from './admonition-modal'
import { $createAdmonitionNode, $isAdmonitionNode, AdmonitionNode } from './admonition-node'
import type { AdmonitionAttributes, AdmonitionType } from './node-types'
import type { AdmonitionData } from './types'

export type InsertAdmonitionPayload = Readonly<AdmonitionAttributes>

// Re-exported for backwards compatibility — the commands now live in their
// own leaf module so the node can dispatch the "open modal" command without
// importing this extension.
export { INSERT_ADMONITION_COMMAND, OPEN_ADMONITION_MODAL_COMMAND }

// ---------------------------------------------------------------------------
// Body restriction — structure-enforcing transform.
//
// The admonition body is deliberately limited to formatted text + links
// (paragraphs only): no nested admonitions, no images / embeds, no headings /
// lists / tables / code blocks. Insert-command guards prevent the common
// entry points; this transform is the backstop for paste and markdown import.
// ---------------------------------------------------------------------------

/** True when the selection's anchor sits inside an admonition body. */
function $selectionInsideAdmonition(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) {
    return false
  }
  return $findMatchingParent(selection.anchor.getNode(), $isAdmonitionNode) != null
}

/** Flatten a disallowed block child to a paragraph, preserving inline content. */
function $flattenToParagraph(element: ElementNode): void {
  const paragraph = $createParagraphNode()
  const children = element.getChildren()
  const allInline =
    children.length > 0 &&
    children.every((child) => $isTextNode(child) || $isLineBreakNode(child) || child.isInline())
  if (allInline) {
    paragraph.append(...children)
  } else {
    const text = element.getTextContent()
    if (text.length > 0) {
      paragraph.append($createTextNode(text))
    }
  }
  element.replace(paragraph)
}

function $normalizeAdmonition(node: AdmonitionNode): void {
  // Never allow an admonition to nest inside another — unwrap this one,
  // hoisting its children to sit before it in the outer admonition.
  const parent = node.getParent()
  const ancestorAdmonition =
    parent != null ? $findMatchingParent(parent, (candidate) => $isAdmonitionNode(candidate)) : null
  if (ancestorAdmonition != null) {
    for (const child of node.getChildren()) {
      node.insertBefore(child)
    }
    node.remove()
    return
  }

  if (node.getChildrenSize() === 0) {
    node.append($createParagraphNode())
    return
  }

  for (const child of node.getChildren()) {
    if ($isParagraphNode(child)) {
      continue
    }
    // Inline / text / linebreak stragglers → wrap in a paragraph.
    if ($isTextNode(child) || $isLineBreakNode(child) || child.isInline()) {
      const paragraph = $createParagraphNode()
      child.insertBefore(paragraph)
      paragraph.append(child)
      continue
    }
    // Decorators (images, embeds, horizontal rule) aren't allowed in the body.
    if ($isDecoratorNode(child)) {
      child.remove()
      continue
    }
    // Other block elements (headings, lists, quotes, tables, code) collapse
    // to a paragraph.
    if ($isElementNode(child)) {
      $flattenToParagraph(child)
    }
  }
}

// ---------------------------------------------------------------------------
// Shadow-root escape — insert a paragraph above/below when the caret is at the
// admonition's outer edge, so the block never traps the cursor. Mirrors the
// Lexical Collapsible plugin.
// ---------------------------------------------------------------------------

function $onEscapeUp(): boolean {
  const selection = $getSelection()
  if ($isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 0) {
    const admonition = $findMatchingParent(selection.anchor.getNode(), $isAdmonitionNode)
    if ($isAdmonitionNode(admonition)) {
      const parent = admonition.getParent()
      if (
        parent != null &&
        parent.getFirstChild() === admonition &&
        selection.anchor.key === admonition.getFirstDescendant()?.getKey()
      ) {
        admonition.insertBefore($createParagraphNode())
      }
    }
  }
  return false
}

function $onEscapeDown(): boolean {
  const selection = $getSelection()
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const admonition = $findMatchingParent(selection.anchor.getNode(), $isAdmonitionNode)
    if ($isAdmonitionNode(admonition)) {
      const parent = admonition.getParent()
      if (parent != null && parent.getLastChild() === admonition) {
        const lastParagraph = admonition.getLastDescendant()
        if (
          lastParagraph != null &&
          selection.anchor.key === lastParagraph.getKey() &&
          selection.anchor.offset === lastParagraph.getTextContentSize()
        ) {
          admonition.insertAfter($createParagraphNode())
        }
      }
    }
  }
  return false
}

export function AdmonitionPlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = React.useState(false)
  // Null target = insert a new admonition; a key = edit that existing node.
  const [editNodeKey, setEditNodeKey] = React.useState<NodeKey | null>(null)
  const [modalData, setModalData] = React.useState<{
    title: string
    admonitionType?: AdmonitionType
  }>({ title: '', admonitionType: undefined })

  useEffect(() => {
    if (!editor.hasNodes([AdmonitionNode])) {
      throw new Error('AdmonitionPlugin: AdmonitionNode not registered on editor')
    }

    return mergeRegister(
      editor.registerCommand<{ nodeKey: NodeKey } | null>(
        OPEN_ADMONITION_MODAL_COMMAND,
        (payload) => {
          if (payload == null) {
            setEditNodeKey(null)
            setModalData({ title: '', admonitionType: undefined })
            setOpen(true)
            return true
          }
          const data = editor.getEditorState().read(() => {
            const node = $getNodeByKey(payload.nodeKey)
            return $isAdmonitionNode(node)
              ? { title: node.getTitle(), admonitionType: node.getAdmonitionType() }
              : null
          })
          if (data == null) {
            return false
          }
          setEditNodeKey(payload.nodeKey)
          setModalData(data)
          setOpen(true)
          return true
        },
        COMMAND_PRIORITY_NORMAL
      ),

      editor.registerCommand<InsertAdmonitionPayload>(
        INSERT_ADMONITION_COMMAND,
        (payload) => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) {
            return false
          }
          // No nesting — refuse (silently) when already inside an admonition.
          if ($selectionInsideAdmonition()) {
            return true
          }
          const admonition = $createAdmonitionNode(payload)
          admonition.append($createParagraphNode())
          $insertNodeToNearestRoot(admonition)
          admonition.selectStart()
          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),

      // Structure / restriction backstop.
      editor.registerNodeTransform(AdmonitionNode, $normalizeAdmonition),

      // Shadow-root caret escape.
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, $onEscapeDown, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, $onEscapeDown, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, $onEscapeUp, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_LEFT_COMMAND, $onEscapeUp, COMMAND_PRIORITY_LOW)
    )
  }, [editor])

  const handleSubmit = ({ admonitionType, title }: AdmonitionData): void => {
    setOpen(false)
    if (admonitionType == null) {
      return
    }
    const key = editNodeKey
    if (key != null) {
      editor.update(() => {
        const node = $getNodeByKey(key)
        if ($isAdmonitionNode(node)) {
          node.update({ admonitionType, title })
        }
      })
    } else {
      editor.dispatchCommand(INSERT_ADMONITION_COMMAND, { admonitionType, title })
    }
    setEditNodeKey(null)
  }

  return (
    <AdmonitionModal
      open={open}
      data={modalData}
      onClose={() => {
        setOpen(false)
        setEditNodeKey(null)
      }}
      onSubmit={handleSubmit}
    />
  )
}

/**
 * Floating text-format toolbar scoped to admonition bodies. Only mounts when
 * the global `FloatingTextFormatExtension` is *absent* — when it's present, it
 * already covers admonition bodies (and everywhere else), so this would just
 * double up. This is what gives the body its bold/italic/link popover on
 * editors (e.g. the AI editor) that suppress the global one.
 */
function AdmonitionFloatingTextFormat({
  anchorElem,
}: BylineFloatingUIProps): React.JSX.Element | null {
  const hasGlobalToolbar = useOptionalExtensionDependency(FloatingTextFormatExtension) !== undefined
  if (hasGlobalToolbar) {
    return null
  }
  return (
    <FloatingTextFormatToolbarPlugin
      anchorElem={anchorElem}
      shouldShow={$selectionInsideAdmonition}
    />
  )
}

function AdmonitionInsertItem(): React.JSX.Element {
  const editor = useToolbarActiveEditor()
  return (
    <DropDownItem
      onClick={() => {
        editor.dispatchCommand(OPEN_ADMONITION_MODAL_COMMAND, null)
      }}
      className="item"
    >
      <i className="icon admonition" />
      <span className="text">Admonition</span>
    </DropDownItem>
  )
}

export const AdmonitionExtension = defineExtension({
  name: '@byline/richtext-lexical/Admonition',
  nodes: () => [AdmonitionNode],
  dependencies: [configExtension(ReactExtension, { decorators: [<AdmonitionPlugin key="d" />] })],
  peerDependencies: [
    declarePeerDependency<typeof BylineToolbarExtension>(BylineToolbarExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/Admonition/insert',
          placement: 'insert-menu',
          order: 30,
          node: <AdmonitionInsertItem />,
        },
      ],
    } satisfies Partial<BylineToolbarConfig>),
    declarePeerDependency<typeof BylineFloatingUIExtension>(BylineFloatingUIExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/Admonition/floating-text-format',
          Component: AdmonitionFloatingTextFormat,
        },
      ],
    } satisfies Partial<BylineFloatingUIConfig>),
  ],
})
