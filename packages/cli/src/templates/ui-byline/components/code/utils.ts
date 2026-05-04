import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

function replaceAllNBSP(input: string) {
  // Regular expression to match all non-breaking spaces in the string
  const regex = /\u00A0/g
  // Replace them with normal spaces
  return input.replace(regex, ' ')
}

export function extractCodeLines(nodes: SerializedLexicalNode[]): string {
  let result: string = ''
  for (const node of nodes) {
    if (node.type === 'code-highlight' && node.text != null) {
      result = result + replaceAllNBSP(node.text)
    } else if (node.type === 'linebreak') {
      result = `${result}\r\n`
    }
  }
  return result
}
