import type { EditorConfig as LexicalEditorConfig } from 'lexical'

import type { ExtensionsList } from './extensions-list'

/**
 * Interface preferences — which controls the editing surface shows.
 *
 * Every flag here hides an affordance and NOTHING else. None of them
 * restricts what the field accepts: content still arrives by paste, by
 * Markdown, and from storage regardless. What a field supports is
 * decided by its resolved editor — the extensions it is configured with,
 * everything those pull in transitively, and mandatory core nodes.
 *
 * If you want to stop a structure existing in a field, remove the
 * extension that owns it:
 * `lexicalEditor((c) => c.extensions.remove(builtInExtensions.Heading))`.
 */
export interface EditorControls {
  /**
   * Show the block-format dropdown. Its entries are further limited to
   * the formats the editor can actually produce, so this hides a control
   * that is already capability-aware.
   */
  blockFormat: boolean
  /**
   * Show the inline-code button.
   *
   * This does NOT prevent inline code. Inline code is a `TextNode`
   * format rather than a node type, so it has no node to unregister and
   * still arrives by paste. Node-level configuration cannot constrain
   * it, and neither can this flag.
   */
  inlineCode: boolean
  /** Show the undo and redo buttons. Keyboard undo keeps working either way. */
  undoRedo: boolean
  /** Show the text-alignment controls. */
  textAlignment: boolean
  /** Show the Markdown source-mode toggle. */
  markdownToggle: boolean
  /** Show the Lexical tree view beneath the editor. */
  treeView: boolean
}

export interface EditorSettings {
  /**
   * Which editing surface to mount: `RichTextPlugin` or
   * `PlainTextPlugin`. Plain-text mode also hides the toolbar.
   *
   * This selects the plugin and its input handling — it does NOT change
   * what the field accepts. Switching to `plainText` unregisters no node
   * class, so structural content already in a stored value still loads,
   * and a paste is still governed by the editor's registered nodes. To
   * stop a structure existing in the field, remove the extension that
   * owns it.
   */
  mode: 'richText' | 'plainText'
  /**
   * Enable Markdown input shortcuts (`# `, `- `, `> ` as you type). The
   * active transformer set follows the editor's registered nodes, so a
   * shortcut for a structure the field does not support never fires.
   */
  markdownShortcuts: boolean
  controls: EditorControls
  /** Render debug output and the tree view. */
  debug: boolean
  /**
   * Upload collection passed to the inline-image picker. Forwarded to
   * `InlineImageExtension`'s config when the extensions list is built;
   * setting it here is equivalent to
   * `c.extensions.configure(InlineImageExtension, { collection })`.
   */
  inlineImageUploadCollection: string
  placeholderText: string
}

export interface EditorSettingsOverride {
  mode?: EditorSettings['mode']
  markdownShortcuts?: boolean
  controls?: Partial<EditorControls>
  debug?: boolean
  inlineImageUploadCollection?: string
  placeholderText?: string
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
