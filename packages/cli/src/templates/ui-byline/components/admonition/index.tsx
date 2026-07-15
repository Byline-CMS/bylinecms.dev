'use client'

import type React from 'react'

import type { Intent } from '@byline/ui/react'
import { Alert } from '@byline/ui/react'

import type { Locale } from '@/ui/byline/types/i18n'
import type { SerializeOptions, SerializeProps } from '../richtext-lexical/serialize/index.tsx'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

const intentMap = {
  note: 'info' as Intent,
  tip: 'success' as Intent,
  warning: 'warning' as Intent,
  danger: 'danger' as Intent,
}

export function AdmonitionSerializer({
  node,
  serialize,
  lng,
  options,
}: {
  node: SerializedLexicalNode
  serialize: ({ nodes }: SerializeProps) => React.JSX.Element
  lng: Locale
  options: SerializeOptions
}): React.JSX.Element {
  const intent = intentMap[node.admonitionType as keyof typeof intentMap]
  // Admonitions are ElementNodes, so their body is stored directly in children.
  return (
    <div className="not-prose pt-6 pb-8">
      <Alert title={node.title} intent={intent} close={false} className="not-prose my-0">
        {node.children != null ? (
          serialize({ nodes: node.children, lng, options })
        ) : (
          <span>Content not found for admonition.</span>
        )}
      </Alert>
    </div>
  )
}
