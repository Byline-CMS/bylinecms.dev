import type { EditorState, LexicalEditor } from 'lexical'

import type { EditorSettings } from './config/types'

export interface OnChangeProps {
  onChange: (editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => void
  initialJSON: any
  config: EditorSettings
  value: any
  setValue: (value: any) => void
}
