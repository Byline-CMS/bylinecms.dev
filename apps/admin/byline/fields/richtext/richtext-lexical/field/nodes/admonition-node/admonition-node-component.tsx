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

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalNestedComposer } from '@lexical/react/LexicalNestedComposer'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { mergeRegister } from '@lexical/utils'
import cx from 'classnames'
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
import type * as React from 'react'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useEditorConfig } from '../../config/editor-config-context'
import { useSharedHistoryContext } from '../../context/shared-history-context'
import { useSharedOnChange } from '../../context/shared-on-change-context'
import { AdmonitionDrawer } from '../../plugins/admonition-plugin/admonition-drawer'
import type { AdmonitionData } from '../../plugins/admonition-plugin/types'
import { FloatingTextFormatToolbarPlugin } from '../../plugins/floating-text-format-toolbar-plugin/index'
// import { LinkPlugin } from '../../plugins/link-plugin/link'
// import { FloatingLinkEditorPlugin } from '../../plugins/link-plugin/link/floating-link-editor'
import { ContentEditable } from '../../ui/content-editable'
import { Placeholder } from '../../ui/placeholder'

import type { AdmonitionNode } from './admonition-node'
import { $isAdmonitionNode } from './admonition-node'
import { DangerIcon, NoteIcon, TipIcon, WarningIcon } from './icons'
import type { AdmonitionAttributes, AdmonitionType } from './types'

import './admonition-node-component.css'

const icons = {
  note: NoteIcon,
  tip: TipIcon,
  warning: WarningIcon,
  danger: DangerIcon,
}

export default function AdmonitionNodeComponent({
  admonitionType,
  title,
  content,
  nodeKey,
}: {
  admonitionType: AdmonitionType
  title: string
  content: LexicalEditor
  nodeKey: NodeKey
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [editor] = useLexicalComposerContext()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const { historyState } = useSharedHistoryContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)
  const [selection, setSelection] = useState<RangeSelection | NodeSelection | BaseSelection | null>(
    null
  )
  const { uuid } = useEditorConfig()
  const { onChange } = useSharedOnChange()
  const editorState = editor.getEditorState()
  const activeEditorRef = useRef<LexicalEditor | null>(null)
  const node = editorState.read(() => $getNodeByKey(nodeKey) as AdmonitionNode)

  const onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isAdmonitionNode(node)) {
          node?.remove()
        }
        setSelected(false)
      }
      return false
    },
    [isSelected, nodeKey, setSelected]
  )

  const onEnter = useCallback(
    (event: KeyboardEvent) => {
      const latestSelection = $getSelection()
      if (
        isSelected &&
        $isNodeSelection(latestSelection) &&
        latestSelection.getNodes().length === 1
      ) {
        $setSelection(null)
        event.preventDefault()
        content.focus()
        return true
      }
      return false
    },
    [content, isSelected]
  )

  const onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (activeEditorRef.current === content || buttonRef.current === event.target) {
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
    [content, editor, setSelected]
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
      editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW)
    )
    return () => {
      isMounted = false
      unregister()
    }
  }, [editor, onDelete, onEnter, onEscape])

  const draggable = isSelected && $isNodeSelection(selection)
  const isFocused = isSelected

  const handleToggleModal = (): void => {
    if (uuid != null) {
      setOpen(!open)
    }
  }

  const handleUpdateAdmonition = ({ admonitionType, title }: AdmonitionData): void => {
    setOpen(false)
    if (title != null && admonitionType != null) {
      const admonitionPayload: AdmonitionAttributes = {
        admonitionType,
        title,
      }

      editor.update(() => {
        node.update(admonitionPayload)
      })
    } else {
      console.error('Error: unable to find image source from document.')
    }
  }

  const classNames = cx(
    'Admonition__container',
    { focused: isFocused },
    { draggable: $isNodeSelection(selection) }
  )

  const Icon = icons[admonitionType]

  return (
    <Suspense fallback={null}>
      <div draggable={draggable} className={classNames}>
        <button
          type="button"
          className="admonition-edit-button"
          ref={buttonRef}
          onClick={handleToggleModal}
        >
          Edit
        </button>
        <div className="AdmonitionNode__header">
          <Icon />
          <div>{title}</div>
        </div>
        <div className="AdmonitionNode__content">
          <LexicalNestedComposer initialEditor={content}>
            <OnChangePlugin
              ignoreSelectionChange={true}
              onChange={(nestedEditorState, nestedEditor, nestedTags) => {
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
            {/* <LinkPlugin />
            <FloatingLinkEditorPlugin />
            <FloatingTextFormatToolbarPlugin /> */}
            <HistoryPlugin externalHistoryState={historyState} />
            <RichTextPlugin
              contentEditable={<ContentEditable className="AdmonitionNode__contentEditable" />}
              placeholder={
                <Placeholder className="Admonition__placeholder">Enter some text...</Placeholder>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </LexicalNestedComposer>
        </div>
      </div>

      {uuid != null && uuid.length > 0 && (
        <AdmonitionDrawer
          open={open}
          onClose={handleToggleModal}
          onSubmit={handleUpdateAdmonition}
          data={{ title, admonitionType }}
        />
      )}
    </Suspense>
  )
}
