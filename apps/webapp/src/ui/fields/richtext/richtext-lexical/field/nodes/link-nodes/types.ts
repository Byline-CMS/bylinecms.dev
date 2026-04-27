import type { SerializedElementNode, Spread } from 'lexical'

import type { DocumentRelation } from '../document-relation'

export interface LinkAttributes {
  url?: string
  rel?: null | string
  newTab?: boolean
  linkType?: 'custom' | 'internal'
  doc?: DocumentRelation | null
}

export type SerializedLinkNode = Spread<
  {
    attributes: LinkAttributes
  },
  SerializedElementNode
>
