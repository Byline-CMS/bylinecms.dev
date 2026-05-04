'use client'

import type React from 'react'

import { Code } from './code.tsx'
import { extractCodeLines } from './utils.ts'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function CodeSerializer({
  node,
}: {
  node: SerializedLexicalNode
}): React.JSX.Element | null {
  if (node?.children != null) {
    const codeLines = extractCodeLines(node.children)
    return <Code code={codeLines} language={node?.language} />
  } else {
    return null
  }
}
