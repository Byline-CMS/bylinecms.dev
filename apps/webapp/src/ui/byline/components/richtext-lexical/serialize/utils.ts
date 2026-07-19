import type { SerializedLexicalNode } from './types.ts'

/**
 * Flatten a heading node's descendants to their plain text. Walks the whole
 * subtree, so nested formatting — bold, inline code, a link — contributes its
 * text too. Kept in step with `../../heading-anchor/utils.ts`.
 */
export function extractHeadingText(nodes?: SerializedLexicalNode[]): string {
  if (nodes == null) return ''

  let text = ''
  for (const node of nodes) {
    if (node.type === 'text' && node.text != null) {
      text = text + node.text
    }
    if (node.children != null) {
      text = text + extractHeadingText(node.children)
    }
  }
  return text
}
