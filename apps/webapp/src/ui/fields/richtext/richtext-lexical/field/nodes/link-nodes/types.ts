import type { SerializedElementNode, Spread } from 'lexical'

import type { DocumentRelation } from '../document-relation'

interface BaseLinkAttributes {
  newTab?: boolean
  rel?: null | string
}

/** Custom (external / arbitrary URL) link. */
export interface CustomLinkAttributes extends BaseLinkAttributes {
  linkType?: 'custom'
  url?: string
}

/**
 * Internal link to a Byline document. The relation envelope (`targetDocumentId`,
 * `targetCollectionId`, `targetCollectionPath`, `document`) is flattened
 * directly onto the attributes alongside `linkType` — same shape pattern as
 * the `RelationField` value, no extra wrapper.
 */
export interface InternalLinkAttributes extends BaseLinkAttributes, DocumentRelation {
  linkType: 'internal'
}

export type LinkAttributes = CustomLinkAttributes | InternalLinkAttributes

export type SerializedLinkNode = Spread<
  {
    attributes: LinkAttributes
  },
  SerializedElementNode
>
