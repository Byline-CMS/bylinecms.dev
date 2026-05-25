import type { EditorConfig as LexicalEditorConfig } from 'lexical'

import { theme } from '../themes/lexical-editor-theme'
import type { EditorConfig, EditorSettings } from './types'

export const defaultEditorLexicalConfig: LexicalEditorConfig = {
  namespace: 'LexicalRichText',
  theme,
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  options: {
    richText: true,
    showTreeView: false,
    textAlignment: true,
    markdownShortcutPlugin: false,
    undoRedo: true,
    textStyle: true,
    inlineCode: true,
    debug: false,
  },
  inlineImageUploadCollection: 'media',
  placeholderText: 'Enter some rich text...',
}

/**
 * Server-safe editor config — settings + Lexical core config only. The
 * `extensions` field is intentionally omitted because extension entries
 * carry React-bearing decorators that would break tsx-loaded seeds and
 * other server-side schema consumers. The client-side
 * `defaultClientEditorConfig` (in `default-extensions.tsx`) layers the
 * extensions list on top.
 */
export const defaultEditorConfig: EditorConfig = {
  settings: DEFAULT_EDITOR_SETTINGS,
  lexical: defaultEditorLexicalConfig,
}
