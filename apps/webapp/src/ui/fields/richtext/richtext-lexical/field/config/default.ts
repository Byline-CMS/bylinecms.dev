import type { EditorConfig as LexicalEditorConfig } from 'lexical'

import { theme } from '../themes/lexical-editor-theme'
import type { EditorConfig, EditorSettings } from './types'

export const defaultEditorLexicalConfig: LexicalEditorConfig = {
  namespace: 'LexicalRichText',
  theme,
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  options: {
    disableBeforeInput: false,
    autocomplete: false,
    charLimit: false,
    charLimitUtf8: false,
    collab: false,
    maxLength: false,
    richText: true,
    measureTypingPerf: false,
    showNestedEditorTreeView: false,
    showTableOfContents: false,
    showTreeView: false,
    textAlignment: true,
    tablePlugin: true,
    tableCellBackgroundColor: true,
    tableCellMerge: true,
    tableActionMenuPlugin: true,
    layoutPlugin: true,
    outputHTML: false,
    outputMarkdown: false,
    autoFocusPlugin: false,
    autoLinkPlugin: false,
    inlineImagePlugin: true,
    admonitionPlugin: true,
    checkListPlugin: true,
    listPlugin: true,
    codeHighlightPlugin: true,
    horizontalRulePlugin: true,
    markdownShortcutPlugin: false,
    undoRedo: true,
    textStyle: true,
    inlineCode: true,
    links: true,
    floatingLinkEditorPlugin: true,
    floatingTextFormatToolbarPlugin: false,
    autoEmbedPlugin: true,
    debug: false,
  },
  inlineImageUploadCollection: 'media',
  placeholderText: 'Enter some rich text...',
}

export const defaultEditorConfig: EditorConfig = {
  settings: DEFAULT_EDITOR_SETTINGS,
  lexical: defaultEditorLexicalConfig,
}
