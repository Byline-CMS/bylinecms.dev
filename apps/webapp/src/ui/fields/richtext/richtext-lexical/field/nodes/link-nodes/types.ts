import type { SerializedElementNode, Spread } from 'lexical'

export interface LinkAttributes {
  url?: string
  rel?: null | string
  newTab?: boolean
  linkType?: 'custom' | 'internal'
  doc?: {
    value: string
    relationTo: string
  } | null
}

export type SerializedLinkNode = Spread<
  {
    attributes: LinkAttributes
  },
  SerializedElementNode
>
