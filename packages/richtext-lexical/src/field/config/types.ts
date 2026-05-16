import type { EditorConfig as LexicalEditorConfig } from 'lexical'

import type { ExtensionsList } from './extensions-list'

/**
 * Settings that aren't expressible as "is extension X present in the
 * extensions list?" — toolbar / UI mode toggles, debug switches, the
 * inline-image upload target, etc. Everything else now lives on
 * {@link EditorConfig.extensions} and is manipulated via the chainable
 * `lexicalEditor((c) => c.extensions.add(...).remove(...))` API.
 */
export type OptionName =
  | 'richText'
  | 'showTreeView'
  | 'textAlignment'
  | 'markdownShortcutPlugin'
  | 'undoRedo'
  | 'textStyle'
  | 'inlineCode'
  | 'debug'

export interface EditorSettings {
  options: Record<OptionName, boolean>
  /**
   * Upload collection passed to the inline-image picker. Forwarded to
   * `InlineImageExtension`'s config when the extensions list is built;
   * setting it here is equivalent to
   * `c.extensions.configure(InlineImageExtension, { collection })`.
   */
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
  /**
   * Manipulable list of Lexical extensions wired into the editor. When
   * omitted (server-safe `defaultEditorConfig` from `/server` does not
   * carry one), the editor falls back to the package's built-in list at
   * render time.
   *
   * Field-level `RichTextField.editorConfig` should not set this
   * directly — extension references are not JSON-safe and would break
   * tsx-loaded seeds. Per-field extension overrides go through a
   * client-side wrapper component registered via
   * `FieldAdminConfig.editor` (see `aiRichTextAdmin()` for the pattern).
   */
  extensions?: ExtensionsList
}
