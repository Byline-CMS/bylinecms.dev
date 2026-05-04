'use client'

import type React from 'react'

import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function ListSerializer({
  node,
  children,
}: {
  node: SerializedLexicalNode
  children: React.ReactNode
}): React.JSX.Element {
  type List = Extract<keyof React.JSX.IntrinsicElements, 'ul' | 'ol'>
  const Tag = node?.tag as List
  return <Tag className={node?.listType}>{children}</Tag>
}
