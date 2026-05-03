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
export { EditorField } from './field/editor-field'
export { Nodes } from './field/nodes'
export { lexicalEditor } from './lexical-editor'
export { RichTextField } from './richtext-field'
export { createEmptyEditorState } from './validate/createEmptyEditorState'
export { hasText } from './validate/hasText'
export type { EditorConfig, EditorSettings, EditorSettingsOverride } from './field/config/types'
export type { DocumentRelation } from './field/nodes/document-relation'
export type {
  InlineImageAttributes,
  Position as InlineImagePosition,
  SerializedInlineImageNode,
} from './field/nodes/inline-image-node/types'
