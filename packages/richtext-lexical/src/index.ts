// Foundational Lexical types re-exported so consumers (renderers,
// serializers) can type their inputs without taking a direct dep on
// the underlying Lexical version.
export type {
  SerializedEditor,
  SerializedEditorState,
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedRootNode,
  SerializedTextNode,
} from 'lexical'

export { defaultEditorConfig } from './field/config/default'
export {
  defaultClientEditorConfig,
  defaultExtensionsArray,
  defaultExtensionsList,
} from './field/config/default-extensions'
export { ExtensionsList } from './field/config/extensions-list'
export { EditorField } from './field/editor-field'
// Built-in extensions exposed for `lexicalEditor((c) => c.extensions...)`
// manipulation and for third-party extensions to declare against via
// peer dependencies.
export { AdmonitionExtension } from './field/extensions/admonition/admonition-extension'
export { AutoEmbedExtension } from './field/extensions/auto-embed/auto-embed-extension'
export {
  type BylineToolbarConfig,
  BylineToolbarExtension,
  type BylineToolbarItem,
  type BylineToolbarPlacement,
  selectToolbarItems,
} from './field/extensions/byline-toolbar'
export { CodeHighlightExtension } from './field/extensions/code-highlight/code-highlight-extension'
export { HorizontalRuleExtension } from './field/extensions/horizontal-rule/horizontal-rule-extension'
export {
  type InlineImageConfig,
  InlineImageExtension,
} from './field/extensions/inline-image/inline-image-extension'
export { LayoutExtension } from './field/extensions/layout/layout-extension'
export { AutoLinkExtension, LinkExtension } from './field/extensions/link'
export { TableExtension } from './field/extensions/table/table-extension'
export { VimeoExtension } from './field/extensions/vimeo/vimeo-extension'
export { YouTubeExtension } from './field/extensions/youtube/youtube-extension'
export { Nodes } from './field/nodes'
// Hook for extensions that contribute toolbar items via
// BylineToolbarExtension and need the active editor for command dispatch.
export {
  ToolbarActiveEditorProvider,
  useToolbarActiveEditor,
} from './field/plugins/toolbar-plugin/toolbar-active-editor'
export { lexicalEditor } from './lexical-editor'
export { RichTextField } from './richtext-field'
export { createEmptyEditorState } from './validate/createEmptyEditorState'
export { hasText } from './validate/hasText'
export type { EditorConfig, EditorSettings, EditorSettingsOverride } from './field/config/types'
export type {
  InlineImageAttributes,
  Position as InlineImagePosition,
  SerializedInlineImageNode,
} from './field/extensions/inline-image/node-types'
export type { DocumentRelation } from './field/nodes/document-relation'
