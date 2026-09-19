// 'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import * as React from 'react'
import { Suspense } from 'react'

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
} from 'lexical'
import { $applyNodeReplacement, createEditor, DecoratorNode } from 'lexical'

import type { DocumentRelation } from '../../nodes/document-relation'
import type { LinkAttributes } from '../link'
import type { InlineImageAttributes, Position, SerializedInlineImageNode } from './node-types'

const InlineImageComponent = React.lazy(async () => await import('./inline-image-node-component'))

/**
 * Encode an optional click-through target onto the exported `<img>`.
 *
 * Deliberately NOT an `<a>` wrapper: Lexical's own link conversion would
 * claim that anchor on re-import and produce a link node wrapping an
 * inline-image node — a shape this plugin does not model. Discrete
 * `data-link-*` attributes survive the existing `img` conversion instead.
 *
 * The denormalised `{ title, path }` bag is not encoded. It is re-derived
 * by `inlineImageLinkVisitor` on the next save or read, so the relation
 * ids are all the markup needs to carry.
 */
function writeLinkAttributes(element: HTMLElement, link: LinkAttributes | undefined): void {
  if (link == null) return
  element.setAttribute('data-link-type', link.linkType ?? 'custom')
  if (link.newTab === true) element.setAttribute('data-link-new-tab', 'true')
  if (link.linkType === 'internal') {
    element.setAttribute('data-link-target-document-id', link.targetDocumentId)
    element.setAttribute('data-link-target-collection-id', link.targetCollectionId)
    element.setAttribute('data-link-target-collection-path', link.targetCollectionPath)
  } else if (link.url != null) {
    element.setAttribute('data-link-url', link.url)
  }
}

/** Inverse of `writeLinkAttributes`. Returns undefined for an unlinked image. */
function readLinkAttributes(domNode: HTMLElement): LinkAttributes | undefined {
  const linkType = domNode.dataset.linkType
  if (linkType !== 'custom' && linkType !== 'internal') return undefined
  const newTab = domNode.dataset.linkNewTab === 'true'
  if (linkType === 'internal') {
    const targetDocumentId = domNode.dataset.linkTargetDocumentId
    const targetCollectionPath = domNode.dataset.linkTargetCollectionPath
    // Without both ids there is nothing to resolve; drop the link rather
    // than carry an envelope the visitor can never hydrate.
    if (!targetDocumentId || !targetCollectionPath) return undefined
    return {
      linkType: 'internal',
      newTab,
      targetDocumentId,
      targetCollectionId: domNode.dataset.linkTargetCollectionId ?? '',
      targetCollectionPath,
    }
  }
  const url = domNode.dataset.linkUrl
  if (!url) return undefined
  return { linkType: 'custom', url, newTab }
}

function convertInlineImageElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLImageElement) {
    const { alt: altText, src, width, height } = domNode
    // HTML round-trip carries only the document id and the collection path
    // (not the collection's UUID). `targetCollectionId` is left empty here;
    // editor flows that need the UUID should re-pick via the modal.
    const node = $createInlineImageNode({
      targetDocumentId: (domNode.dataset.id as string | undefined) ?? '',
      targetCollectionId: '',
      targetCollectionPath: (domNode.dataset.collection as string | undefined) ?? '',
      src,
      altText,
      height,
      width,
      link: readLinkAttributes(domNode),
    })
    return { node }
  }
  return null
}

export class InlineImageNode extends DecoratorNode<React.JSX.Element> {
  __relation: DocumentRelation
  __src: string
  __position: Position
  __altText: string | undefined
  __width: number | string | undefined
  __height: number | string | undefined
  __showCaption: boolean
  __caption: LexicalEditor
  __link: LinkAttributes | undefined

  static getType(): string {
    return 'inline-image'
  }

  static clone(node: InlineImageNode): InlineImageNode {
    return new InlineImageNode(
      node.__relation,
      node.__src,
      node.__position,
      node.__altText,
      node.__width,
      node.__height,
      node.__showCaption,
      node.__caption,
      node.__link,
      node.__key
    )
  }

  static importJSON(serializedNode: SerializedLexicalNode): InlineImageNode {
    const {
      src,
      position,
      altText,
      height,
      width,
      showCaption,
      caption,
      link,
      targetDocumentId,
      targetCollectionId,
      targetCollectionPath,
      document,
    } = serializedNode as SerializedInlineImageNode
    const node = $createInlineImageNode({
      targetDocumentId,
      targetCollectionId,
      targetCollectionPath,
      document,
      src,
      position,
      altText,
      width,
      height,
      showCaption,
      link,
    })
    const nestedEditor = node.__caption
    const editorState = nestedEditor.parseEditorState(caption.editorState)
    if (!editorState.isEmpty()) {
      nestedEditor.setEditorState(editorState)
    }
    return node
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: (_node: Node) => ({
        conversion: convertInlineImageElement,
        priority: 0,
      }),
    }
  }

  constructor(
    relation: DocumentRelation,
    src: string,
    position: Position,
    altText?: string,
    width?: number | string,
    height?: number | string,
    showCaption?: boolean,
    caption?: LexicalEditor,
    link?: LinkAttributes,
    key?: NodeKey
  ) {
    super(key)
    this.__relation = relation
    this.__src = src
    this.__position = position
    this.__altText = altText
    this.__width = width
    this.__height = height
    this.__showCaption = showCaption ?? false
    this.__caption = caption ?? createEditor()
    this.__link = link
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('img')
    element.setAttribute('data-id', this.__relation.targetDocumentId)
    element.setAttribute('data-collection', this.__relation.targetCollectionPath)
    element.setAttribute('src', this.__src)
    element.setAttribute('alt', this.__altText as string)

    // Width and height will be undefined for SVGs
    if (this.__width != null) {
      element.setAttribute('width', this.__width.toString())
    }
    if (this.__height != null) {
      element.setAttribute('height', this.__height.toString())
    }
    writeLinkAttributes(element, this.__link)
    return { element }
  }

  exportJSON(): SerializedInlineImageNode {
    return {
      ...this.__relation,
      src: this.getSrc(),
      position: this.__position,
      altText: this.getAltText(),
      height: this.__height,
      width: this.__width,
      showCaption: this.__showCaption,
      caption: this.__caption.toJSON(),
      link: this.__link,
      type: 'inline-image',
      version: 1,
    }
  }

  getRelation(): DocumentRelation {
    return this.__relation
  }

  getSrc(): string {
    return this.__src
  }

  getAltText(): string {
    return this.__altText as string
  }

  setAltText(altText: string): void {
    const writable = this.getWritable()
    writable.__altText = altText
  }

  setWidthAndHeight(width: number | string, height: number | string): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  getShowCaption(): boolean {
    return this.__showCaption
  }

  setShowCaption(showCaption: boolean): void {
    const writable = this.getWritable()
    writable.__showCaption = showCaption
  }

  getLink(): LinkAttributes | undefined {
    return this.__link
  }

  setLink(link: LinkAttributes | undefined): void {
    const writable = this.getWritable()
    writable.__link = link
  }

  getPosition(): Position {
    return this.__position
  }

  setPosition(position: Position): void {
    const writable = this.getWritable()
    writable.__position = position
  }

  update(payload: InlineImageAttributes): void {
    const writable = this.getWritable()
    const {
      targetDocumentId,
      targetCollectionId,
      targetCollectionPath,
      document,
      src,
      position,
      altText,
      height,
      width,
      showCaption,
    } = payload

    if (targetDocumentId != null) {
      writable.__relation = {
        targetDocumentId,
        targetCollectionId,
        targetCollectionPath,
        document,
      }
    }
    if (src != null) {
      writable.__src = src
    }
    if (position != null) {
      writable.__position = position
    }
    if (altText != null) {
      writable.__altText = altText
    }
    if (width != null) {
      writable.__width = width
    }
    if (height != null) {
      writable.__height = height
    }
    if (showCaption != null) {
      writable.__showCaption = showCaption
    }
    // `link` is keyed on PRESENCE, not on null-ness, unlike every field
    // above. The `!= null` convention cannot express "remove the link" —
    // an explicit `link: undefined` would be a silent no-op — and
    // clearing a click target has to work.
    if ('link' in payload) {
      writable.__link = payload.link
    }
  }

  // View

  /**
   * `has-link` drives the editor's cursor affordance — see
   * `inline-image-node-component.css`. It is a class rather than a
   * decorator-side style so the hover state is correct before React has
   * hydrated the decorator.
   */
  private buildClassName(config: EditorConfig): string {
    const linked = this.__link != null ? ' has-link' : ''
    return `${config.theme.inlineImage} position-${this.__position}${linked}`
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    span.className = this.buildClassName(config)
    return span
  }

  updateDOM(prevNode: InlineImageNode, dom: HTMLElement, config: EditorConfig): boolean {
    if (
      this.__position !== prevNode.__position ||
      (this.__link != null) !== (prevNode.__link != null)
    ) {
      dom.className = this.buildClassName(config)
      return true
    }
    if (this.__showCaption !== prevNode.__showCaption) return true
    if (this.__link !== prevNode.__link) return true
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <InlineImageComponent
          relation={this.__relation}
          src={this.__src}
          position={this.__position}
          altText={this.__altText}
          width={this.__width}
          height={this.__height}
          showCaption={this.__showCaption}
          caption={this.__caption}
          link={this.__link}
          nodeKey={this.getKey()}
        />
      </Suspense>
    )
  }
}

export function $createInlineImageNode({
  targetDocumentId,
  targetCollectionId,
  targetCollectionPath,
  document,
  src,
  position,
  altText,
  height,
  width,
  showCaption,
  caption,
  link,
  key,
}: InlineImageAttributes): InlineImageNode {
  const relation: DocumentRelation = {
    targetDocumentId,
    targetCollectionId,
    targetCollectionPath,
    document,
  }
  return $applyNodeReplacement(
    new InlineImageNode(
      relation,
      src,
      position,
      altText,
      width,
      height,
      showCaption,
      caption,
      link,
      key
    )
  )
}

export function $isInlineImageNode(node: LexicalNode | null | undefined): node is InlineImageNode {
  return node instanceof InlineImageNode
}
