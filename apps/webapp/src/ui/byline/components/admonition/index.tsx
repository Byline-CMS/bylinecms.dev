'use clients'

import type React from 'react'

import type { Intent } from '@infonomic/uikit/react'
import { Alert } from '@infonomic/uikit/react'

import type { Locale } from '@/i18n/i18n-config'
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
  return (
    <Alert title={node.title} intent={intent} close={false} className="rounded-none">
      {node?.content?.editorState?.root?.children != null ? (
        serialize({ nodes: node?.content?.editorState?.root?.children, lng, options })
      ) : (
        <span>Content not found for admonition.</span>
      )}
    </Alert>
  )
}
