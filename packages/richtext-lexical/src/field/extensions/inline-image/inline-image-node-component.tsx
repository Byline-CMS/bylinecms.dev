// 'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalNestedComposer } from '@lexical/react/LexicalNestedComposer'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { mergeRegister } from '@lexical/utils'
import cx from 'clsx'
import type { BaseSelection, LexicalEditor, NodeKey, NodeSelection, RangeSelection } from 'lexical'
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'

import ContentEditableInline from '../../content-editable-inline'
import { useSharedHistoryContext } from '../../context/shared-history-context'
import { useSharedOnChange } from '../../context/shared-on-change-context'
import PlaceholderInline from '../../ui/placeholder-inline'
import { FloatingTextFormatToolbarPlugin } from '../floating-text-format'
import { FloatingLinkEditorPlugin } from '../link/floating-link-editor'
import { LinkPlugin } from '../link/link-extension'
import { resolveLinkHref } from '../link/link-href'
import { OPEN_INLINE_IMAGE_MODAL_COMMAND } from './inline-image-extension'
import { $isInlineImageNode } from './inline-image-node'
import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '../link'
import type { Position } from './node-types'

import './inline-image-node-component.css'

const imageCache = new Set()

async function useSuspenseImage(src: string): Promise<void> {
  if (!imageCache.has(src)) {
    await new Promise((resolve) => {
      const img = new Image()
      img.src = src
      img.onload = () => {
        imageCache.add(src)
        resolve(null)
      }
    })
  }
}

function LazyImage({
  id,
  collection,
  src,
  position,
  altText,
  className,
  imageRef,
  width,
  height,
}: {
  id: string
  collection: string
  src: string
  position: Position
  altText?: string
  className?: string
  height?: number | string
  width?: number | string
  imageRef: { current: null | HTMLImageElement }
}): React.JSX.Element {
  void useSuspenseImage(src)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={altText}
      ref={imageRef}
      width={width}
      height={height}
      data-id={id}
      data-collection={collection}
      data-position={position}
      style={{
        display: 'block',
      }}
      draggable="false"
    />
  )
}

export default function InlineImageComponent({
  relation,
  src,
  position,
  altText,
  width,
  height,
  showCaption,
  caption,
  link,
  nodeKey,
}: {
  relation: DocumentRelation
  src: string
  position: Position
  altText?: string
  height?: number | string
  width?: number | string
  showCaption: boolean
  caption: LexicalEditor
  link?: LinkAttributes
  nodeKey: NodeKey
}): React.JSX.Element {
  const { targetDocumentId: id, targetCollectionPath: collection } = relation
  const [editor] = useLexicalComposerContext()
  const { onChange } = useSharedOnChange()
  const { historyState } = useSharedHistoryContext()
  const imageRef = useRef<null | HTMLImageElement>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [selection, setSelection] = useState<RangeSelection | NodeSelection | BaseSelection | null>(
    null
  )

  const activeEditorRef = useRef<LexicalEditor | null>(null)

  // Held in a ref so the CLICK_COMMAND registration (which must not
  // re-register on every link change) always reads the current target.
  const linkHref = resolveLinkHref(link)
  const linkHrefRef = useRef<string | null>(linkHref)
  linkHrefRef.current = linkHref

  const onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isInlineImageNode(node)) {
          node?.remove()
        }
        setSelected(false)
      }
      return false
    },
    [isSelected, nodeKey, setSelected]
  )

  const onEnter = useCallback(
    // KEY_ENTER_COMMAND carries `KeyboardEvent | null` — Lexical synthesises an
    // Enter with a null event when an IME composition ends in a newline, and
    // that path reaches node selections too. There is nothing to preventDefault
    // in that case, but the focus move still applies.
    (event: KeyboardEvent | null) => {
      const latestSelection = $getSelection()
      const buttonElem = buttonRef.current
      if (
        isSelected &&
        $isNodeSelection(latestSelection) &&
        latestSelection.getNodes().length === 1
      ) {
        if (showCaption) {
          // Move focus into nested editor
          $setSelection(null)
          event?.preventDefault()
          caption.focus()
          return true
        } else if (buttonElem !== null && buttonElem !== document.activeElement) {
          event?.preventDefault()
          buttonElem.focus()
          return true
        }
      }
      return false
    },
    [caption, isSelected, showCaption]
  )

  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (activeEditorRef.current === caption || buttonRef.current === event.target) {
        $setSelection(null)
        editor.update(() => {
          setSelected(true)
          const parentRootElement = editor.getRootElement()
          if (parentRootElement !== null) {
            parentRootElement.focus()
          }
        })
        return true
      }
      return false
    },
    [caption, editor, setSelected]
  )

  useEffect(() => {
    let isMounted = true
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isMounted) {
          setSelection(editorState.read(() => $getSelection()))
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_, activeEditor) => {
          activeEditorRef.current = activeEditor
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          const event = payload
          if (event.target === imageRef.current) {
            // Cmd/ctrl-click opens the click target, matching the
            // convention of every other editor that shows a pointer
            // cursor over linked content. Without this the `has-link`
            // cursor would promise something a plain click never does —
            // a plain click must keep selecting the node.
            const href = linkHrefRef.current
            if (href != null && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              window.open(href, '_blank', 'noopener,noreferrer')
              return true
            }
            if (event.shiftKey) {
              setSelected(!isSelected)
            } else {
              clearSelection()
              setSelected(true)
            }
            return true
          }

          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (event.target === imageRef.current) {
            // TODO This is just a temporary workaround for FF to behave like other browsers.
            // Ideally, this handles drag & drop too (and all browsers).
            event.preventDefault()
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW)
    )
    return () => {
      isMounted = false
      unregister()
    }
  }, [clearSelection, editor, isSelected, onDelete, onEnter, onEscape, setSelected])

  const draggable = isSelected && $isNodeSelection(selection)
  const isFocused = isSelected

  // Open the plugin-hosted modal in edit mode for this node. The plugin
  // reads the current attributes via `nodeKey` and pre-fills the form.
  // Short, human-readable description of where the image points. Falls
  // back to a plain warning when the target is gone, which mirrors what
  // the public renderer does (it drops the anchor entirely).
  const linkBadgeLabel = ((): string => {
    if (link == null) return ''
    if (link.linkType === 'internal') {
      if (link.document?._resolved === false) return 'Missing target'
      return link.document?.title ?? link.targetCollectionPath
    }
    try {
      return new URL(link.url ?? '').hostname
    } catch {
      return link.url ?? ''
    }
  })()

  const handleToggleModal = (): void => {
    editor.dispatchCommand(OPEN_INLINE_IMAGE_MODAL_COMMAND, { nodeKey })
  }

  const classNames = cx(
    'InlineImageNode__container',
    { focused: isFocused },
    { draggable: $isNodeSelection(selection) }
  )

  // TODO: consider implementing a single-line custom editor with span and inline
  // elements in order to keep caption html valid from within the parent paragraph
  // https://github.com/facebook/lexical/discussions/3640
  return (
    <Suspense fallback={null}>
      <span draggable={draggable} className={classNames}>
        <button
          type="button"
          className="image-edit-button"
          ref={buttonRef}
          onClick={handleToggleModal}
        >
          Edit
        </button>
        {link != null && (
          <button
            type="button"
            className="image-link-badge"
            title={
              linkHref != null
                ? `Links to ${linkHref} — ⌘/Ctrl-click the image to open`
                : 'Link target could not be resolved'
            }
            onClick={handleToggleModal}
          >
            <span aria-hidden="true">🔗</span>
            <span className="image-link-badge__label">{linkBadgeLabel}</span>
          </button>
        )}
        <LazyImage
          id={id}
          collection={collection}
          src={src}
          position={position}
          altText={altText}
          imageRef={imageRef}
          width={width}
          height={height}
        />
        {showCaption && (
          <span className="InlineImageNode__caption_container">
            <LexicalNestedComposer initialEditor={caption}>
              <OnChangePlugin
                ignoreSelectionChange={true}
                onChange={(_nestedEditorState, _nestedEditor, nestedTags) => {
                  // Note: Shared 'onChange' context provider so that
                  // caption change events can be registered with the parent
                  // editor - in turn triggering the parent editor onChange
                  // event, and therefore updating editorState and the field
                  // value in Payload (Save Draft and Publish Changes will then
                  // become 'enabled' from the caption as well as the parent
                  // editor content.)

                  // Parent editor state - not the LexicalNestedComposer in this case
                  // although there are other ways that this could be used.
                  const editorState = editor.getEditorState()
                  if (onChange != null) onChange(editorState, editor, nestedTags)
                }}
              />
              <LinkPlugin />
              <FloatingLinkEditorPlugin />
              <FloatingTextFormatToolbarPlugin />
              <HistoryPlugin externalHistoryState={historyState} />
              <RichTextPlugin
                contentEditable={
                  <ContentEditableInline className="InlineImageNode__contentEditable" />
                }
                placeholder={
                  <PlaceholderInline className="InlineImageNode__placeholder">
                    Enter a caption...
                  </PlaceholderInline>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </LexicalNestedComposer>
          </span>
        )}
      </span>
    </Suspense>
  )
}
