'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'

import { TRANSFORMERS } from '@lexical/markdown'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { useOptionalExtensionDependency } from '@lexical/react/useExtensionComponent'
import type { EditorState, LexicalEditor } from 'lexical'

import { useEditorConfig } from './config/editor-config-context'
import { ContentEditable } from './content-editable'
import { useSharedHistoryContext } from './context/shared-history-context'
import { useSharedOnChange } from './context/shared-on-change-context'
import { Debug } from './debug'
import { FloatingLinkEditorPlugin } from './extensions/link/floating-link-editor'
import { TableExtension as BylineTableExtension } from './extensions/table/table-extension'
// import { AiPlugin } from './plugins/ai-plugin'
// import { DragDropPaste } from './plugins/drag-drop-paste-plugin'
import { FloatingTextFormatToolbarPlugin } from './plugins/floating-text-format-toolbar-plugin'
import { TableActionMenuPlugin } from './plugins/table-action-menu-plugin'
import { TablePlugin } from './plugins/table-plugin'
import { ToolbarPlugin } from './plugins/toolbar-plugin'
import { TreeViewPlugin } from './plugins/treeview-plugin'
import { CAN_USE_DOM } from './shared/canUseDOM'
import { Placeholder } from './ui/placeholder'

import './editor.css'

import { APPLY_VALUE_TAG } from './constants'

// We memoize the EditorComponent to prevent re-renders from parent components or
// other editor instances. Only internal state changes for a given (this)
// editor instance should trigger re-renders. Our form-context and value handlers
// are subscription-based and so in theory this shouldn't be necessary, but
// here just in case.
export const Editor = memo(function Editor({
  minHeight,
  maxHeight,
}: {
  minHeight?: number | string
  maxHeight?: number | string
}): React.JSX.Element {
  const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null)
  const [isSmallWidthViewport, setIsSmallWidthViewport] = useState<boolean>(false)
  const _debugTagLogCountRef = useState(() => ({ count: 0 }))[0]
  const { onChange } = useSharedOnChange()
  const { historyState } = useSharedHistoryContext()
  const {
    config: {
      options: {
        debug,
        richText,
        showTreeView,
        tableActionMenuPlugin,
        markdownShortcutPlugin,
        floatingLinkEditorPlugin,
        floatingTextFormatToolbarPlugin,
      },
      placeholderText,
    },
  } = useEditorConfig()
  const hasTableExtension = useOptionalExtensionDependency(BylineTableExtension) !== undefined

  const onRef = useCallback((_floatingAnchorElem: HTMLDivElement): void => {
    if (_floatingAnchorElem != null) {
      setFloatingAnchorElem(_floatingAnchorElem)
    }
  }, [])

  const richTextContentEditable = useMemo(
    () => (
      <div
        className="editor-scroller"
        style={{ minHeight: minHeight ?? '150px', maxHeight: maxHeight ?? undefined }}
      >
        <div className="editor" ref={onRef}>
          <ContentEditable />
        </div>
      </div>
    ),
    [onRef, minHeight, maxHeight]
  )

  const plainTextContentEditable = useMemo(
    () => (
      <div
        className="editor-scroller"
        style={{ minHeight: minHeight ?? '150px', maxHeight: maxHeight ?? undefined }}
      >
        <div className="editor">
          <ContentEditable />
        </div>
      </div>
    ),
    [minHeight, maxHeight]
  )

  useEffect(() => {
    const updateViewPortWidth = (): void => {
      const isNextSmallWidthViewport =
        CAN_USE_DOM && window.matchMedia('(max-width: 1025px)').matches

      if (isNextSmallWidthViewport !== isSmallWidthViewport) {
        setIsSmallWidthViewport(isNextSmallWidthViewport)
      }
    }
    updateViewPortWidth()
    window.addEventListener('resize', updateViewPortWidth)

    return () => {
      window.removeEventListener('resize', updateViewPortWidth)
    }
  }, [isSmallWidthViewport])

  const content = (
    <>
      {hasTableExtension && <TablePlugin />}
      {richText && <ToolbarPlugin />}
      <div
        className={`editor-container ${showTreeView ? 'tree-view' : ''} ${
          !richText ? 'plain-text' : ''
        }`}
      >
        {/* <DragDropPaste /> */}
        <OnChangePlugin
          // Ignore any onChange event triggered by focus or selection only
          ignoreSelectionChange={true}
          onChange={(editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => {
            // if (process.env.NODE_ENV === 'production' && _debugTagLogCountRef.count < 10) {
            //   _debugTagLogCountRef.count++
            //   // eslint-disable-next-line no-console
            //   console.log('[lexical][top] tags', Array.from(tags))
            // }
            if (tags.has(APPLY_VALUE_TAG)) return
            if (!tags.has('focus') || tags.size > 1) {
              if (onChange != null) onChange(editorState, editor, tags)
            }
          }}
        />
        {richText ? (
          <>
            <RichTextPlugin
              contentEditable={richTextContentEditable}
              placeholder={<Placeholder>{placeholderText}</Placeholder>}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin externalHistoryState={historyState} />
            {markdownShortcutPlugin && <MarkdownShortcutPlugin transformers={TRANSFORMERS} />}
            {floatingAnchorElem != null && !isSmallWidthViewport && (
              <>
                {floatingLinkEditorPlugin && (
                  <FloatingLinkEditorPlugin anchorElem={floatingAnchorElem} />
                )}
                {tableActionMenuPlugin && (
                  <TableActionMenuPlugin anchorElem={floatingAnchorElem} cellMerge={false} />
                )}
                {floatingTextFormatToolbarPlugin && (
                  <FloatingTextFormatToolbarPlugin anchorElem={floatingAnchorElem} />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <PlainTextPlugin
              contentEditable={plainTextContentEditable}
              placeholder={<Placeholder>{placeholderText}</Placeholder>}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin externalHistoryState={historyState} />
          </>
        )}
        {debug && (
          <>
            <Debug />
            <TreeViewPlugin />
          </>
        )}
      </div>
    </>
  )

  // TODO: re-enable when inline images are supported
  // if (inlineImagePlugin) {
  //   return <InlineImageContextProvider>{content}</InlineImageContextProvider>
  // }

  return content
})
