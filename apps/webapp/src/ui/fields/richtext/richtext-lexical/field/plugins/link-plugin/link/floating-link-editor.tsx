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
import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $findMatchingParent, mergeRegister } from '@lexical/utils'
import {
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { createPortal } from 'react-dom'

import {
  $isAutoLinkNode,
  $isLinkNode,
  type LinkAttributes,
  TOGGLE_LINK_COMMAND,
} from '../../../nodes/link-nodes'
import { getSelectedNode } from '../../../utils/getSelectedNode'
import { setFloatingElemPositionForLinkEditor } from '../../../utils/setFloatingElemPositionForLinkEditor'
import { sanitizeUrl } from '../../../utils/url'
import { LinkModal } from './link-modal'
import type { LinkData } from './types'

import './floating-link-editor.css'

interface LinkEditorState {
  label: string | null
  url: string
}

interface FloatingLinkEditorProps {
  editor: LexicalEditor
  isLink: boolean
  setIsLink: Dispatch<boolean>
  anchorElem: HTMLElement
}

function FloatingLinkEditor({
  editor,
  isLink,
  setIsLink,
  anchorElem,
}: FloatingLinkEditorProps): React.JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null)

  const [linkEditorState, setLinkEditorState] = useState<LinkEditorState>({
    label: null,
    url: '',
  })
  const [linkModalData, setLinkModalData] = useState<LinkData | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)

  const $updateLinkEditor = useCallback(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      const node = getSelectedNode(selection)
      const linkParent = $findMatchingParent(node, $isLinkNode)

      let data: LinkData = {
        text: '',
        fields: {
          url: '',
          linkType: undefined,
          newTab: undefined,
          doc: undefined,
        },
      }

      const linkNode = linkParent ?? ($isLinkNode(node) ? node : null)

      if (linkNode != null) {
        data = {
          text: linkNode.getTextContent(),
          fields: linkNode.getAttributes(),
        }

        if (data.fields?.linkType === 'internal') {
          const doc = data.fields?.doc
          setLinkEditorState({
            label: doc != null ? `${doc.relationTo} · ${doc.value.slice(0, 8)}…` : null,
            url: doc != null ? `/${doc.relationTo}/${doc.value}` : '',
          })
        } else {
          setLinkEditorState({
            label: null,
            url: data.fields?.url ?? '',
          })
        }
      } else {
        setLinkEditorState({ label: null, url: '' })
      }

      setLinkModalData(data)
    }

    const editorElem = editorRef.current
    const nativeSelection = window.getSelection()
    const { activeElement } = document

    if (editorElem === null) {
      return
    }

    const rootElement = editor.getRootElement()

    if (
      selection !== null &&
      nativeSelection !== null &&
      rootElement?.contains(nativeSelection.anchorNode) &&
      editor.isEditable()
    ) {
      const domRect: DOMRect | undefined =
        nativeSelection.focusNode?.parentElement?.getBoundingClientRect()
      if (domRect != null) {
        domRect.y += 40
        setFloatingElemPositionForLinkEditor(domRect, editorElem, anchorElem)
      }
    } else if (activeElement == null || activeElement.className !== 'link-input') {
      if (rootElement !== null) {
        setFloatingElemPositionForLinkEditor(null, editorElem, anchorElem)
      }
      setLinkEditorState({ label: null, url: '' })
    }

    return true
  }, [anchorElem, editor])

  useEffect(() => {
    const scrollerElem = anchorElem.parentElement

    const update = (): void => {
      editor.getEditorState().read(() => {
        $updateLinkEditor()
      })
    }

    window.addEventListener('resize', update)

    if (scrollerElem != null) {
      scrollerElem.addEventListener('scroll', update)
    }

    return () => {
      window.removeEventListener('resize', update)

      if (scrollerElem != null) {
        scrollerElem.removeEventListener('scroll', update)
      }
    }
  }, [anchorElem.parentElement, editor, $updateLinkEditor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateLinkEditor()
        })
      }),

      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $updateLinkEditor()
          return true
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (isLink) {
            setIsLink(false)
            return true
          }
          return false
        },
        COMMAND_PRIORITY_HIGH
      )
    )
  }, [editor, $updateLinkEditor, setIsLink, isLink])

  useEffect(() => {
    editor.getEditorState().read(() => {
      $updateLinkEditor()
    })
  }, [editor, $updateLinkEditor])

  const handleModalSubmit = (data: LinkData): void => {
    const fields = data.fields ?? {}
    const newAttributes: LinkAttributes & { text?: string } = {
      linkType: fields.linkType,
      newTab: fields.newTab,
      url: fields.linkType === 'custom' ? fields.url : undefined,
      doc: fields.linkType === 'internal' ? fields.doc : null,
      text: data.text ?? undefined,
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, newAttributes)
  }

  return (
    <div ref={editorRef} className="link-editor">
      {isLink && (
        <>
          <div className="link-input">
            <a href={sanitizeUrl(linkEditorState.url)} target="_blank" rel="noopener noreferrer">
              {linkEditorState.label != null && linkEditorState.label.length > 0
                ? linkEditorState.label
                : linkEditorState.url}
            </a>
            <div
              aria-label="Edit link"
              className="link-edit"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setModalOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setModalOpen(true)
                }
              }}
            />
            <div
              aria-label="Remove link"
              className="link-trash"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
                }
              }}
            />
          </div>
          <LinkModal
            isOpen={modalOpen}
            data={linkModalData}
            onSubmit={handleModalSubmit}
            onClose={() => setModalOpen(false)}
          />
        </>
      )}
    </div>
  )
}

function useFloatingLinkEditor(
  editor: LexicalEditor,
  anchorElem: HTMLElement
): React.JSX.Element | null {
  const [activeEditor, setActiveEditor] = useState(editor)
  const [isLink, setIsLink] = useState(false)

  useEffect(() => {
    const $determineIsLink = () => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        const focusNode = getSelectedNode(selection)
        const focusLinkNode = $findMatchingParent(focusNode, $isLinkNode)
        const focusAutoLinkNode = $findMatchingParent(focusNode, $isAutoLinkNode)
        if (focusLinkNode == null && focusAutoLinkNode == null) {
          setIsLink(false)
          return
        }
        const invalidLinkNode = selection
          .getNodes()
          .filter((node) => !$isLineBreakNode(node))
          .find((node) => {
            const linkNode = $findMatchingParent(node, $isLinkNode)
            const autoLinkNode = $findMatchingParent(node, $isAutoLinkNode)
            return (
              (focusLinkNode && !focusLinkNode.is(linkNode)) ||
              (linkNode && !linkNode.is(focusLinkNode)) ||
              (focusAutoLinkNode && !focusAutoLinkNode.is(autoLinkNode)) ||
              (autoLinkNode && !autoLinkNode.is(focusAutoLinkNode))
            )
          })
        setIsLink(invalidLinkNode == null)
      }
    }

    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $determineIsLink()
        })
      }),

      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, newEditor) => {
          $determineIsLink()
          setActiveEditor(newEditor)
          return false
        },
        COMMAND_PRIORITY_CRITICAL
      )
    )
  }, [editor])

  return createPortal(
    <FloatingLinkEditor
      editor={activeEditor}
      anchorElem={anchorElem}
      isLink={isLink}
      setIsLink={setIsLink}
    />,
    anchorElem
  )
}

export function FloatingLinkEditorPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  return useFloatingLinkEditor(editor, anchorElem)
}
