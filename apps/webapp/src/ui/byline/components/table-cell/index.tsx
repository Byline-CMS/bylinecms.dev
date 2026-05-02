import { Table } from '@infonomic/uikit/react'

import type { Locale } from '@/i18n/i18n-config'
import type { SerializeOptions, SerializeProps } from '../richtext-lexical/serialize/index.tsx'
import type { SerializedLexicalNode } from '../richtext-lexical/serialize/types.ts'

export function TableCellSerializer({
  node,
  serialize,
  lng,
  options,
}: {
  node: SerializedLexicalNode
  serialize: ({ nodes, options }: SerializeProps) => React.JSX.Element
  lng: Locale
  options: SerializeOptions
}): React.JSX.Element {
  // Disable any animations for any child nodes that appear inside a table cell
  const tableCellOptions: SerializeOptions = { ...options, disableAnimation: true }

  if (node?.headerState === 1 || node?.headerState === 2 || node?.headerState === 3) {
    return (
      <Table.Cell>
        {node?.children != null &&
          serialize({ nodes: node?.children, lng, options: tableCellOptions })}
      </Table.Cell>
    )
  } else {
    return (
      <Table.Cell>
        {node?.children != null &&
          serialize({ nodes: node?.children, lng, options: tableCellOptions })}
      </Table.Cell>
    )
  }
}
