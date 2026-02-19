/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { addClassNamesToElement, isHTMLAnchorElement } from '@lexical/utils'
import {
  $applyNodeReplacement,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  createCommand,
  type DOMConversionMap,
  type DOMConversionOutput,
  type EditorConfig,
  ElementNode,
  type LexicalCommand,
  type LexicalNode,
  type NodeKey,
  type NodeSelection,
  type RangeSelection,
} from 'lexical'

import { sanitizeUrl } from '../../utils/url'
import type { SerializedAutoLinkNode } from './auto-link-node'
import type { LinkAttributes, SerializedLinkNode } from './types'

/** @noInheritDoc */
export class LinkNode extends ElementNode {
  __attributes: LinkAttributes

  static getType(): string {
    return 'link'
  }

  static clone(node: LinkNode): LinkNode {
    return new LinkNode({
      attributes: node.__attributes,
      key: node.__key,
    })
  }

  constructor({
    attributes = {
      url: undefined,
      newTab: false,
      rel: null,
      doc: null,
      linkType: 'custom',
    },
    key,
  }: {
    attributes: LinkAttributes
    key?: NodeKey
  }) {
    super(key)
    this.__attributes = attributes
  }

  createDOM(config: EditorConfig): HTMLAnchorElement {
    const element = document.createElement('a')
    if (this.__attributes?.linkType === 'custom') {
      element.href = sanitizeUrl(this.__attributes.url ?? '')
    } else {
      // TODO: note the admin/collections url doesn't actually matter here, as this link
      // will not be followed. Instead the floating link editor will appear.
      // That said - it would be nice to be able to access the payload routes/admin configuration
      // value to ensure that this is the correct admin path.
      element.href = `/admin/collections/${this.__attributes.doc?.relationTo}/${this.__attributes.doc?.value}`
    }

    if (this.__attributes?.newTab ?? false) {
      element.target = '_blank'
    }

    element.rel = ''

    if (this.__attributes?.newTab === true && this.__attributes?.linkType === 'custom') {
      element.rel = manageRel(element.rel, 'add', 'noopener')
      element.rel = manageRel(element.rel, 'add', 'nofollow')
    }

    if (this.__attributes?.rel != null) {
      element.rel += ` ${this.__attributes?.rel}`
    }

    addClassNamesToElement(element, config.theme.link)

    return element
  }

  updateDOM(prevNode: LinkNode, anchor: HTMLAnchorElement, _config: EditorConfig): boolean {
    const url = this.__attributes?.url
    const newTab = this.__attributes?.newTab
    const rel = this.__attributes?.rel

    // A custom URL but the URL has been updated.
    if (
      url != null &&
      url !== prevNode.__attributes?.url &&
      this.__attributes?.linkType === 'custom'
    ) {
      anchor.href = url
    }

    // We've changed from a custom URL to an internal URL
    if (
      this.__attributes?.linkType === 'internal' &&
      prevNode.__attributes?.linkType === 'custom'
    ) {
      // TODO: note the admin/collections url doesn't actually matter here, as this link
      // will not be followed. Instead the floating link editor will appear.
      // That said - it would be nice to be able to access the payload routes/admin configuration
      // value to ensure that this is the correct admin path.
      anchor.href = `/admin/collections/${this.__attributes.doc?.relationTo}/${this.__attributes.doc?.value}`
    }

    // We've changed the internal URL to a new value
    if (
      this.__attributes.doc?.value !== prevNode.__attributes.doc?.value &&
      this.__attributes?.linkType === 'internal'
    ) {
      // TODO: note the admin/collections url doesn't actually matter here, as this link
      // will not be followed. Instead the floating link editor will appear.
      // That said - it would be nice to be able to access the payload routes/admin configuration
      // value to ensure that this is the correct admin path.
      anchor.href = `/admin/collections/${this.__attributes.doc?.relationTo}/${this.__attributes.doc?.value}`
    }

    // TODO: not 100% sure why we're setting rel to '' - revisit
    // Start rel config here, then check newTab below
    if (anchor.rel == null) {
      anchor.rel = ''
    }

    if (newTab !== prevNode.__attributes?.newTab) {
      if (newTab != null && newTab === true) {
        anchor.target = '_blank'
        if (this.__attributes?.linkType === 'custom') {
          anchor.rel = manageRel(anchor.rel, 'add', 'noopener')
          anchor.rel = manageRel(anchor.rel, 'add', 'nofollow')
        }
      } else {
        anchor.removeAttribute('target')
        anchor.rel = manageRel(anchor.rel, 'remove', 'noopener')
        anchor.rel = manageRel(anchor.rel, 'remove', 'nofollow')
      }
    }

    // TODO - revisit - I don't think there can be any other rel
    // values other than nofollow and noopener - so not
    // sure why anchor.rel += rel below
    if (rel !== prevNode.__attributes.rel) {
      if (rel != null) {
        anchor.rel += rel
      } else {
        anchor.removeAttribute('rel')
      }
    }
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return {
      a: (_node: Node) => ({
        conversion: convertAnchorElement,
        priority: 1,
      }),
    }
  }

  static importJSON(serializedNode: SerializedLinkNode | SerializedAutoLinkNode): LinkNode {
    const node = $createLinkNode({
      attributes: serializedNode.attributes,
    })
    node.setFormat(serializedNode.format)
    node.setIndent(serializedNode.indent)
    node.setDirection(serializedNode.direction)
    return node
  }

  exportJSON(): SerializedLinkNode | SerializedAutoLinkNode {
    return {
      ...super.exportJSON(),
      attributes: this.getAttributes(),
      type: 'link',
      version: 2,
    }
  }

  getAttributes(): LinkAttributes {
    return this.getLatest().__attributes
  }

  setAttributes(attributes: LinkAttributes): void {
    const writable = this.getWritable()
    writable.__attributes = attributes
  }

  insertNewAfter(selection: RangeSelection, restoreSelection = true): null | ElementNode {
    const element = this.getParentOrThrow().insertNewAfter(selection, restoreSelection)
    if ($isElementNode(element)) {
      const linkNode = $createLinkNode({ attributes: this.__attributes })
      element.append(linkNode)
      return linkNode
    }
    return null
  }

  canInsertTextBefore(): false {
    return false
  }

  canInsertTextAfter(): false {
    return false
  }

  canBeEmpty(): false {
    return false
  }

  isInline(): true {
    return true
  }

  extractWithChild(
    _child: LexicalNode,
    selection: RangeSelection | NodeSelection,
    _destination: 'clone' | 'html'
  ): boolean {
    if (!$isRangeSelection(selection)) {
      return false
    }

    const anchorNode = selection.anchor.getNode()
    const focusNode = selection.focus.getNode()

    return (
      this.isParentOf(anchorNode) &&
      this.isParentOf(focusNode) &&
      selection.getTextContent().length > 0
    )
  }
}

function convertAnchorElement(domNode: Node): DOMConversionOutput {
  let node: LinkNode | null = null
  if (isHTMLAnchorElement(domNode)) {
    const content = domNode.textContent
    if (content !== null && content !== '') {
      node = $createLinkNode({
        attributes: {
          url: domNode.getAttribute('href') ?? '',
          rel: domNode.getAttribute('rel'),
          newTab: domNode.getAttribute('target') === '_blank',
          linkType: 'custom',
          doc: null,
        },
      })
    }
  }
  return { node }
}

export function $createLinkNode({ attributes }: { attributes: LinkAttributes }): LinkNode {
  const linkNode = new LinkNode({ attributes })
  return $applyNodeReplacement(linkNode)
}

export function $isLinkNode(node: LexicalNode | null | undefined): node is LinkNode {
  return node instanceof LinkNode
}

export const TOGGLE_LINK_COMMAND: LexicalCommand<LinkAttributes | null> =
  createCommand('TOGGLE_LINK_COMMAND')

export function $toggleLink(linkAttributes: LinkAttributes & { text?: string }): void {
  const selection = $getSelection()

  if (!$isRangeSelection(selection)) {
    return
  }
  const nodes = selection.extract()

  if (linkAttributes === null) {
    // Remove LinkNodes
    nodes.forEach((node) => {
      const parent = node.getParent()

      if ($isLinkNode(parent)) {
        const children = parent.getChildren()

        for (let i = 0; i < children.length; i += 1) {
          parent.insertBefore(children[i])
        }

        parent.remove()
      }
    })
  } else {
    // Add or merge LinkNodes
    if (nodes.length === 1) {
      const firstNode = nodes[0]
      // if the first node is a LinkNode or if its
      // parent is a LinkNode, we update the URL, target and rel.
      const linkNode: LinkNode | null = $isLinkNode(firstNode)
        ? firstNode
        : $getLinkAncestor(firstNode)
      if (linkNode !== null) {
        linkNode.setAttributes(linkAttributes)

        if (linkAttributes.text != null && linkAttributes.text !== linkNode.getTextContent()) {
          // remove all children and add child with new textcontent:
          linkNode.append($createTextNode(linkAttributes.text))
          linkNode.getChildren().forEach((child) => {
            if (child !== linkNode.getLastChild()) {
              child.remove()
            }
          })
        }
        return
      }
    }

    let prevParent: ElementNode | LinkNode | null = null
    let linkNode: LinkNode | null = null

    nodes.forEach((node) => {
      const parent = node.getParent()

      if (parent === linkNode || parent === null || ($isElementNode(node) && !node.isInline())) {
        return
      }

      if ($isLinkNode(parent)) {
        linkNode = parent
        parent.setAttributes(linkAttributes)
        if (linkAttributes.text != null && linkAttributes.text !== parent.getTextContent()) {
          // remove all children and add child with new textcontent:
          parent.append($createTextNode(linkAttributes.text))
          parent.getChildren().forEach((child) => {
            if (child !== parent.getLastChild()) {
              child.remove()
            }
          })
        }
        return
      }

      if (parent.is(prevParent) === false) {
        prevParent = parent
        linkNode = $createLinkNode({ attributes: linkAttributes })

        if ($isLinkNode(parent)) {
          if (node.getPreviousSibling() === null) {
            parent.insertBefore(linkNode)
          } else {
            parent.insertAfter(linkNode)
          }
        } else {
          node.insertBefore(linkNode)
        }
      }

      if ($isLinkNode(node)) {
        if (node.is(linkNode)) {
          return
        }
        if (linkNode !== null) {
          const children = node.getChildren()

          for (let i = 0; i < children.length; i += 1) {
            linkNode.append(children[i])
          }
        }

        node.remove()
        return
      }

      if (linkNode !== null) {
        linkNode.append(node)
      }
    })
  }
}

function $getLinkAncestor(node: LexicalNode): null | LinkNode {
  return $getAncestor(node, (ancestor) => $isLinkNode(ancestor)) as LinkNode
}

function $getAncestor(
  node: LexicalNode,
  predicate: (ancestor: LexicalNode) => boolean
): null | LexicalNode {
  let parent: null | LexicalNode = node
  while (parent !== null) {
    parent = parent.getParent()
    if (parent === null || predicate(parent)) {
      break
    }
  }
  return parent
}

function manageRel(input: string, action: 'add' | 'remove', value: string): string {
  let result: string
  let mutableInput = `${input}`
  if (action === 'add') {
    // if we somehow got out of sync - clean up
    if (mutableInput.includes(value)) {
      const re = new RegExp(value, 'g')
      mutableInput = mutableInput.replace(re, '').trim()
    }
    mutableInput = mutableInput.trim()
    result = mutableInput.length === 0 ? `${value}` : `${mutableInput} ${value}`
  } else {
    const re = new RegExp(value, 'g')
    result = mutableInput.replace(re, '').trim()
  }
  return result
}
