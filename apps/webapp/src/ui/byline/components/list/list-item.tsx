'use client'

import type React from 'react'

import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function ListItemSerializer({
  node,
  children,
}: {
  node: SerializedLexicalNode
  children: React.ReactNode
}): React.JSX.Element {
  if (node?.checked != null) {
    return (
      <li
        className={`not-prose component--list-item-checkbox ${
          node.checked === true
            ? 'component--list-item-checkbox-checked'
            : 'component--list-item-checked-unchecked'
        }`}
        value={node?.value}
        // aria-checked={node.checked === true ? 'true' : 'false'}
        tabIndex={-1}
      >
        {children}
      </li>
    )
  } else {
    return <li value={node?.value}>{children}</li>
  }
}
