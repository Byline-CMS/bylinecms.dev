import type { SerializedElementNode, Spread } from 'lexical'

import type { DocumentRelation } from '../../nodes/document-relation'

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
 * Denormalised document fields carried on an internal-link node.
 *
 *   - `title` — the target document's `useAsTitle` value. Refreshed by the
 *     server-side link walker (both embed-on-save and populate-on-read
 *     pipelines) whenever the target resolves.
 *   - `path` — the canonical renderable path. Has dual meaning during
 *     migration:
 *       * with a leading `/` — composed by `CollectionDefinition.buildDocumentPath`
 *         (or the generic `/${collectionPath}/${slug}` fallback) and
 *         considered authoritative by the renderer.
 *       * without a leading `/` — bare slug from `byline_document_paths`,
 *         either legacy data or a picker-time write that has not yet been
 *         through the walker. The renderer applies the generic compose
 *         fallback in that case.
 *   - `_resolved` — explicitly set to `false` by the walker when the most
 *     recent pass could not find the target document. Absent (i.e. the
 *     property is omitted) when the target resolved on the last pass.
 *     Renderers strip the `<a>` wrapper and render children as plain text
 *     when this is `false`, preserving editor intent without producing
 *     a broken anchor on the public site.
 */
export interface InternalLinkDocument {
  title?: string
  path?: string
  _resolved?: false
}

/**
 * Internal link to a Byline document. The relation envelope (`targetDocumentId`,
 * `targetCollectionId`, `targetCollectionPath`, `document`) is flattened
 * directly onto the attributes alongside `linkType` — same shape pattern as
 * the `RelationField` value, no extra wrapper.
 */
export interface InternalLinkAttributes
  extends BaseLinkAttributes,
    DocumentRelation<InternalLinkDocument> {
  linkType: 'internal'
}

export type LinkAttributes = CustomLinkAttributes | InternalLinkAttributes

export type SerializedLinkNode = Spread<
  {
    attributes: LinkAttributes
  },
  SerializedElementNode
>
