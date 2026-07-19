import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

/**
 * Flatten a heading node's descendants to their plain text.
 *
 * Walks the whole subtree, so a heading carrying nested formatting — bold,
 * inline code, a link — contributes all of its text, not just the segments
 * that happen to sit at the top level. The result feeds `formatTextValue` to
 * derive the heading's anchor id, and the same walk backs the "On this page"
 * table of contents, so both surfaces agree on every heading's id and label.
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
