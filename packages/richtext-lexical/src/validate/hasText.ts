import type {
  SerializedEditorState,
  SerializedLexicalNode,
  SerializedParagraphNode,
  SerializedTextNode,
} from 'lexical'

export function hasText(
  value: SerializedEditorState<SerializedLexicalNode> | null | undefined
): boolean {
  if (value === null || value === undefined) return false

  const rootChildren = value.root?.children
  if (rootChildren === null || rootChildren === undefined) return false
  if (rootChildren.length === 0) return false

  // Treat a single empty paragraph as "no content".
  if (rootChildren.length === 1 && rootChildren[0]?.type === 'paragraph') {
    const paragraphNode = rootChildren[0] as SerializedParagraphNode
    const paragraphChildren = paragraphNode.children

    if (paragraphChildren === null || paragraphChildren === undefined) return false
    if (paragraphChildren.length === 0) return false

    if (paragraphChildren.length === 1 && paragraphChildren[0]?.type === 'text') {
      const textNode = paragraphChildren[0] as SerializedTextNode
      const text = textNode.text
      if (text === null || text === undefined) return false
      if (text.length === 0) return false
    }
  }

  return true
}
