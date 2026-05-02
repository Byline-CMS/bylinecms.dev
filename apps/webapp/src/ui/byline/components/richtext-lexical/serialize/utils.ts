import type { SerializedLexicalNode } from './types.ts'

export function extractHeadingText(nodes?: SerializedLexicalNode[], text: string = ''): string {
  if (nodes != null) {
    for (const node of nodes) {
      if (node.type === 'text' && node.text != null) {
        text = text + node.text
      }
      if (node.children != null) {
        extractHeadingText(node.children, text)
      }
    }
  }
  return text
}
