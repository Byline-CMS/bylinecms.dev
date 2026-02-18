'use client'

import type * as React from 'react'
import { useMemo } from 'react'

import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import type { EditorState, LexicalEditor, SerializedEditorState } from 'lexical'

import { EditorConfigContext } from './config/editor-config-context'
import { SharedHistoryContext } from './context/shared-history-context'
import { SharedOnChangeContext } from './context/shared-on-change-context'
import { Editor } from './editor'
import { Nodes } from './nodes'
import { ToolbarExtensionsProvider } from './toolbar-extensions'
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

  // useMemo for the initialConfig that depends on readOnly and value
  // biome-ignore lint/correctness/useExhaustiveDependencies: TODO: revisit
  const initialConfig = useMemo<InitialConfigType>(() => {
    return {
      editable: readOnly !== true,
      editorState: value != null ? JSON.stringify(value) : undefined,
      namespace: editorConfig.lexical.namespace,
      nodes: [...Nodes],
      onError: (error: Error) => {
        throw error
      },
      theme: editorConfig.lexical.theme,
    }
    // Important: do not add readOnly and value to the dependencies array.
    // This will cause the entire lexical editor to re-render if the document
    // is saved, which will cause the editor to lose focus.

    // NOTE: 2025-04-26: This is NOT the case for our version of the editor.
    // Without readOnly as a dependency, the editor will never transition
    // from readOnly to editable during form loading, when disabledFromField
    // in field-component will be briefly false.
  }, [editorConfig, readOnly])

  if (initialConfig == null) {
    return <p>Loading...</p>
  }

  return (
    <LexicalComposer initialConfig={initialConfig} key={composerKey + initialConfig.editable}>
      <EditorConfigContext config={editorConfig.settings}>
        <SharedOnChangeContext onChange={onChange}>
          <SharedHistoryContext>
            <ToolbarExtensionsProvider>
              <div className="editor-shell">
                {beforeEditor}
                <Editor minHeight={props.minHeight} maxHeight={props.maxHeight} />
                {afterEditor}
                {children}
              </div>
            </ToolbarExtensionsProvider>
          </SharedHistoryContext>
        </SharedOnChangeContext>
      </EditorConfigContext>
    </LexicalComposer>
  )
}
