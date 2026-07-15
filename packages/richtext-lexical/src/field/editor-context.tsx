'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { useMemo } from 'react'

import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import {
  type AnyLexicalExtensionArgument,
  defineExtension,
  type EditorState,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical'

import { defaultExtensionsList } from './config/default-extensions'
import { EditorConfigContext } from './config/editor-config-context'
import { MarkdownModeProvider } from './context/markdown-mode-context'
import { SharedHistoryContext } from './context/shared-history-context'
import { SharedOnChangeContext } from './context/shared-on-change-context'
import { Editor } from './editor'
import { InlineImageExtension } from './extensions/inline-image/inline-image-extension'
import { Nodes } from './nodes'
import type { EditorConfig } from './config/types'

// Catch any errors that occur during Lexical updates and log them
// or throw them as needed. If you don't throw them, Lexical will
// try to recover gracefully without losing user data.
function _onError(error: Error, _editor: LexicalEditor): void {
  // eslint-disable-next-line no-console
  console.error(error)
}

export function EditorContext(props: {
  composerKey: string
  editorConfig: EditorConfig
  onChange: (editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => void
  readOnly: boolean
  value?: SerializedEditorState
  minHeight?: number | string
  maxHeight?: number | string
  children?: React.ReactNode
  beforeEditor?: React.ReactNode[]
  afterEditor?: React.ReactNode[]
}): React.JSX.Element {
  const {
    composerKey,
    editorConfig,
    onChange,
    readOnly,
    value,
    beforeEditor,
    afterEditor,
    children,
  } = props

  const editable = readOnly !== true

  // The root extension must be a referentially stable value across renders.
  // Unlike the legacy LexicalComposer (which memoised the editor with [] deps
  // and ignored subsequent initialConfig changes), LexicalExtensionComposer
  // rebuilds the editor whenever the `extension` prop changes by reference —
  // destroying editor state and history. So we deliberately compute this
  // only on mount and capture readOnly / value / editorConfig from the first
  // render. The `key={composerKey + editable}` below already forces a remount
  // when readOnly toggles, so a fresh extension is built then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: capture-once on mount; remount via `key` handles editable transitions
  const rootExtension = useMemo<AnyLexicalExtensionArgument>(() => {
    // Source of truth for the extension graph: editorConfig.extensions,
    // optionally manipulated by site code via lexicalEditor((c) => ...).
    // Server-loaded EditorConfigs (e.g. via /server) carry no extensions
    // field; in that case we materialise the package default here.
    const extensionsList = editorConfig.extensions ?? defaultExtensionsList()

    // Forward the inline-image upload collection from the settings facade
    // onto the InlineImageExtension's typed config — but ONLY when the
    // extension is actually present. `configure()` has upsert semantics
    // (absent → added), so an ungated call here silently resurrected
    // InlineImageExtension on every editor build for registrations that
    // had deliberately removed it via
    // `lexicalEditor((c) => c.extensions.remove(builtInExtensions.InlineImage))`.
    const configured = extensionsList.clone()
    if (configured.has(InlineImageExtension)) {
      configured.configure(InlineImageExtension, {
        collection: editorConfig.settings.inlineImageUploadCollection,
      })
    }
    const dependencies = configured.toArray()

    return defineExtension({
      name: '[root]',
      namespace: editorConfig.lexical.namespace,
      nodes: [...Nodes],
      theme: editorConfig.lexical.theme,
      editable,
      $initialEditorState: value != null ? JSON.stringify(value) : undefined,
      onError: (error: Error) => {
        throw error
      },
      dependencies,
    })
  }, [])

  // These three context providers MUST sit OUTSIDE LexicalExtensionComposer.
  //
  // LexicalExtensionComposer renders the editor's React decorator portals
  // (the components mounted for AdmonitionNode, InlineImageNode, etc.) as
  // a sibling of its `children` inside an internal EditorChildrenComponent,
  // not as descendants of `children`. Any context provider we place inside
  // the composer is invisible to those decorators — so nested editors
  // wired through SharedOnChangeContext silently fail to propagate change
  // events up to the parent, and SharedHistoryContext falls back to a
  // local history state instead of being shared with the root editor.
  //
  // Hoisting these providers above the composer puts the node decorators
  // back inside their React tree.
  return (
    <EditorConfigContext config={editorConfig.settings}>
      <SharedOnChangeContext onChange={onChange}>
        <SharedHistoryContext>
          <MarkdownModeProvider>
            <LexicalExtensionComposer
              extension={rootExtension}
              contentEditable={null}
              key={composerKey + editable}
            >
              <div className="editor-shell">
                {beforeEditor}
                <Editor minHeight={props.minHeight} maxHeight={props.maxHeight} />
                {afterEditor}
                {children}
              </div>
            </LexicalExtensionComposer>
          </MarkdownModeProvider>
        </SharedHistoryContext>
      </SharedOnChangeContext>
    </EditorConfigContext>
  )
}
