'use client'

import type React from 'react'

import cx from 'classnames'

import type { Locale } from '@/i18n/i18n-config'
import type { SerializeOptions, SerializeProps } from '../richtext-lexical/serialize/index.tsx'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

const layoutMap = {
  '1fr 1fr': 'grid-cols-[1fr_1fr]',
  '1fr 3fr': 'grid-cols-[1fr_3fr]',
  '3fr 1fr': 'grid-cols-[3fr_1fr]',
  '1fr 1fr 1fr': 'grid-cols-[1fr_1fr_1fr]',
  '1fr 2fr 1fr': 'grid-cols-[1fr_2fr_1fr]',
  '1fr 1fr 1fr 1fr': 'grid-cols-[1fr_1fr_1fr_1fr]',
}

export function LayoutContainerSerializer({
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
  const gridColumns = layoutMap[node.templateColumns as keyof typeof layoutMap]
  return (
    <div className={cx('sm:grid gap-5 my-5', gridColumns)}>
      {node?.children != null ? (
        serialize({ nodes: node?.children, lng, options })
      ) : (
        <span>Content not found for layout container.</span>
      )}
    </div>
  )
}

export function LayoutItemSerializer({
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
  return (
    <div className="mb-5 sm:mb-0">
      {node?.children != null ? (
        serialize({ nodes: node?.children, lng, options })
      ) : (
        <span>Content not found for layout item.</span>
      )}
    </div>
  )
}
