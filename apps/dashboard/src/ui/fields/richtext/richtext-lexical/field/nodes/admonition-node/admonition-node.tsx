'use client'
/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

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
import * as React from 'react'
import type { AdmonitionAttributes, AdmonitionType, SerializedAdmonitionNode } from './types'

const AdmonitionNodeComponent = React.lazy(async () => await import('./admonition-node-component'))

function convertAdmonitionElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLDivElement) {
    const type = domNode.dataset.type as AdmonitionType
    const title = domNode.dataset.title as string
    const node = $createAdmonitionNode({ admonitionType: type, title })
    return { node }
  }
  return null
}

export class AdmonitionNode extends DecoratorNode<React.JSX.Element> {
  __admonitionType: AdmonitionType
  __title: string
  __content: LexicalEditor

  static getType(): string {
    return 'admonition'
  }

  static clone(node: AdmonitionNode): AdmonitionNode {
    return new AdmonitionNode(node.__admonitionType, node.__title, node.__content, node.__key)
  }

  static importJSON(serializedNode: SerializedAdmonitionNode): AdmonitionNode {
    const { admonitionType, title, content } = serializedNode
    const node = $createAdmonitionNode({
      admonitionType,
      title,
    })
    const nestedEditor = node.__content
    const editorState = nestedEditor.parseEditorState(content.editorState)
    if (!editorState.isEmpty()) {
      nestedEditor.setEditorState(editorState)
    }
    return node
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (node: Node) => ({
        conversion: convertAdmonitionElement,
        priority: 0,
      }),
    }
  }

  constructor(
    admonitionType: AdmonitionType,
    title: string,
    content?: LexicalEditor,
    key?: NodeKey
  ) {
    super(key)
    this.__admonitionType = admonitionType
    this.__title = title
    this.__content = content ?? createEditor()
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div')
    element.setAttribute('data-type', this.__admonitionType)
    element.setAttribute('data-title', this.__title)
    return { element }
  }

  exportJSON(): SerializedAdmonitionNode {
    return {
      admonitionType: this.__admonitionType,
      title: this.__title,
      content: this.__content.toJSON(),
      type: 'admonition',
      version: 1,
    }
  }

  isInline(): false {
    return false
  }

  getTitle(): string {
    return this.__title
  }

  setTitle(title: string): void {
    const writable = this.getWritable()
    writable.__title = title
  }

  getAdmonitionType(): AdmonitionType {
    return this.__admonitionType
  }

  setAdmonitionType(admonitionType: AdmonitionType): void {
    const writable = this.getWritable()
    writable.__admonitionType = admonitionType
  }

  update(payload: AdmonitionAttributes): void {
    const writable = this.getWritable()
    const { admonitionType, title } = payload
    if (admonitionType != null) {
      writable.__admonitionType = admonitionType
    }
    if (title != null) {
      writable.__title = title
    }
  }

  // View

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div')
    div.setAttribute('data-type', this.__admonitionType)
    div.setAttribute('data-title', this.__title)
    const className = `${config.theme.admonition} admonition-${this.__admonitionType}`
    if (className !== undefined) {
      div.className = className
    }
    return div
  }

  updateDOM(prevNode: AdmonitionNode, dom: HTMLElement, config: EditorConfig): boolean {
    const admonitionType = this.__admonitionType
    if (admonitionType !== prevNode.__admonitionType) {
      const className = `${config.theme.admonition} admonition-${admonitionType}`
      if (className !== undefined) {
        dom.className = className
      }
      dom.setAttribute('data-type', admonitionType)
      return true
    }
    if (this.__title !== prevNode.__title) {
      dom.setAttribute('data-title', this.__title)
      return true
    }
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <AdmonitionNodeComponent
        admonitionType={this.__admonitionType}
        title={this.__title}
        content={this.__content}
        nodeKey={this.getKey()}
      />
    )
  }
}

export function $createAdmonitionNode({
  admonitionType,
  title,
  content,
  key,
}: AdmonitionAttributes): AdmonitionNode {
  return $applyNodeReplacement(new AdmonitionNode(admonitionType, title, content, key))
}

export function $isAdmonitionNode(node: LexicalNode | null | undefined): node is AdmonitionNode {
  return node instanceof AdmonitionNode
}
