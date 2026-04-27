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
} from 'lexical'
import { $applyNodeReplacement, createEditor, DecoratorNode } from 'lexical'

import type { DocumentRelation } from '../document-relation'
import type { InlineImageAttributes, Position, SerializedInlineImageNode } from './types'

const InlineImageComponent = React.lazy(async () => await import('./inline-image-node-component'))

function convertInlineImageElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLImageElement) {
    const { alt: altText, src, width, height } = domNode
    // HTML round-trip carries only the document id and the collection path
    // (not the collection's UUID). `targetCollectionId` is left empty here;
    // editor flows that need the UUID should re-pick via the modal.
    const relation: DocumentRelation = {
      targetDocumentId: (domNode.dataset.id as string | undefined) ?? '',
      targetCollectionId: '',
      targetCollectionPath: (domNode.dataset.collection as string | undefined) ?? '',
    }
    const node = $createInlineImageNode({ relation, src, altText, height, width })
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
      node.__key
    )
  }

  static importJSON(serializedNode: SerializedInlineImageNode): InlineImageNode {
    const { src, position, altText, height, width, showCaption, caption, relation } = serializedNode
    const node = $createInlineImageNode({
      relation,
      src,
      position,
      altText,
      width,
      height,
      showCaption,
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
    return { element }
  }

  exportJSON(): SerializedInlineImageNode {
    return {
      relation: this.__relation,
      src: this.getSrc(),
      position: this.__position,
      altText: this.getAltText(),
      height: this.__height,
      width: this.__width,
      showCaption: this.__showCaption,
      caption: this.__caption.toJSON(),
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

  getPosition(): Position {
    return this.__position
  }

  setPosition(position: Position): void {
    const writable = this.getWritable()
    writable.__position = position
  }

  update(payload: InlineImageAttributes): void {
    const writable = this.getWritable()
    const { relation, src, position, altText, height, width, showCaption } = payload
    if (relation != null) {
      writable.__relation = relation
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
  }

  // View

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span')
    const className = `${config.theme.inlineImage} position-${this.__position}`
    if (className !== undefined) {
      span.className = className
    }
    return span
  }

  updateDOM(prevNode: InlineImageNode, dom: HTMLElement, config: EditorConfig): boolean {
    const position = this.__position
    if (position !== prevNode.__position) {
      const className = `${config.theme.inlineImage} position-${position}`
      if (className !== undefined) {
        dom.className = className
      }
      return true
    }
    if (this.__showCaption !== prevNode.__showCaption) return true
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
          nodeKey={this.getKey()}
        />
      </Suspense>
    )
  }
}

export function $createInlineImageNode({
  relation,
  src,
  position,
  altText,
  height,
  width,
  showCaption,
  caption,
  key,
}: InlineImageAttributes): InlineImageNode {
  return $applyNodeReplacement(
    new InlineImageNode(relation, src, position, altText, width, height, showCaption, caption, key)
  )
}

export function $isInlineImageNode(node: LexicalNode | null | undefined): node is InlineImageNode {
  return node instanceof InlineImageNode
}
