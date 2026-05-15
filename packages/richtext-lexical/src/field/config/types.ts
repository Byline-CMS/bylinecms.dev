import type { EditorConfig as LexicalEditorConfig } from 'lexical'

export type OptionName =
  | 'richText'
  | 'showTreeView'
  | 'textAlignment'
  | 'tablePlugin'
  | 'tableCellBackgroundColor'
  | 'tableCellMerge'
  | 'tableActionMenuPlugin'
  | 'layoutPlugin'
  | 'autoFocusPlugin'
  | 'autoLinkPlugin'
  | 'inlineImagePlugin'
  | 'admonitionPlugin'
  | 'checkListPlugin'
  | 'listPlugin'
  | 'codeHighlightPlugin'
  | 'horizontalRulePlugin'
  | 'markdownShortcutPlugin'
  | 'undoRedo'
  | 'textStyle'
  | 'inlineCode'
  | 'links'
  | 'floatingLinkEditorPlugin'
  | 'floatingTextFormatToolbarPlugin'
  | 'autoEmbedPlugin'
  | 'debug'

export interface EditorSettings {
  options: Record<OptionName, boolean>
  inlineImageUploadCollection: string
  placeholderText: string
  /**
   * Whether relation-bearing nodes (link, inline-image) embed the picker's
   * resolved target fields (`title`, `path`, `altText`, `image`, `sizes`)
   * into the persisted Lexical JSON at modal-save time. Defaults to `true`.
   *
   * Mirrors `RichTextField.embedRelationsOnSave`. The lexical wrapper
   * (`richtext-field.tsx`) merges the field-level value over the resolved
   * editor settings so each field gets the policy it asked for.
   */
  embedRelationsOnSave: boolean
}

export interface EditorSettingsOverride {
  options?: Partial<Record<OptionName, boolean>>
  inlineImageUploadCollection?: string
  placeholderText?: string
  embedRelationsOnSave?: boolean
}

export interface EditorConfig {
  settings: EditorSettings
  lexical: LexicalEditorConfig
}
