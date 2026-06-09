'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementDOMSlot,
  LexicalEditor,
  LexicalNode,
  LexicalUpdateJSON,
  NodeKey,
} from 'lexical'
import { $applyNodeReplacement, ElementNode } from 'lexical'

import { OPEN_ADMONITION_MODAL_COMMAND } from './admonition-commands'
import type { AdmonitionAttributes, AdmonitionType, SerializedAdmonitionNode } from './node-types'

import './admonition-node.css'

const ADMONITION_TYPES: ReadonlySet<string> = new Set(['note', 'tip', 'warning', 'danger'])

function isAdmonitionType(value: unknown): value is AdmonitionType {
  return typeof value === 'string' && ADMONITION_TYPES.has(value)
}

// Inline SVG markup for the header icon, keyed by type. Mirrors the React
// icon components in `./icons` — the ElementNode chrome is plain DOM, so the
// markup is inlined rather than rendered through React.
const ICON_SVG: Record<AdmonitionType, string> = {
  note: '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24"><path d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z"></path></svg>',
  tip: '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24"><path d="M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4C12.76,4 13.5,4.11 14.2,4.31L15.77,2.74C14.61,2.26 13.34,2 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M7.91,10.08L6.5,11.5L11,16L21,6L19.59,4.58L11,13.17L7.91,10.08Z"></path></svg>',
  warning:
    '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"></path></svg>',
  danger:
    '<svg focusable="false" aria-hidden="true" viewBox="0 0 24 24"><path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"></path></svg>',
}

function convertAdmonitionElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLDivElement && domNode.dataset.type != null) {
    const type = domNode.dataset.type
    if (!isAdmonitionType(type)) {
      return null
    }
    const title = domNode.dataset.title ?? ''
    return { node: $createAdmonitionNode({ admonitionType: type, title }) }
  }
  return null
}

/**
 * The admonition (callout) block. An `ElementNode` whose body is real
 * children in the main editor tree — see the module note in
 * `../../markdown/transformers.ts` for why this beats a nested editor for
 * markdown round-tripping. `__admonitionType` / `__title` are attributes set
 * from the Insert/Edit modal and rendered as non-editable chrome; the body
 * (paragraphs + inline content) renders into the slot returned by
 * `getDOMSlot`.
 */
export class AdmonitionNode extends ElementNode {
  __admonitionType: AdmonitionType
  __title: string

  static getType(): string {
    return 'admonition'
  }

  static clone(node: AdmonitionNode): AdmonitionNode {
    return new AdmonitionNode(node.__admonitionType, node.__title, node.__key)
  }

  static importJSON(serializedNode: SerializedAdmonitionNode): AdmonitionNode {
    return $createAdmonitionNode({
      admonitionType: serializedNode.admonitionType,
      title: serializedNode.title,
    }).updateFromJSON(serializedNode)
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (node: HTMLElement) => {
        if (node.dataset.type == null || !isAdmonitionType(node.dataset.type)) {
          return null
        }
        return { conversion: convertAdmonitionElement, priority: 1 }
      },
    }
  }

  constructor(admonitionType: AdmonitionType, title: string, key?: NodeKey) {
    super(key)
    this.__admonitionType = admonitionType
    this.__title = title
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedAdmonitionNode>): this {
    return super
      .updateFromJSON(serializedNode)
      .setAdmonitionType(serializedNode.admonitionType)
      .setTitle(serializedNode.title)
  }

  exportJSON(): SerializedAdmonitionNode {
    return {
      ...super.exportJSON(),
      admonitionType: this.__admonitionType,
      title: this.__title,
    }
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div')
    element.setAttribute('data-type', this.__admonitionType)
    element.setAttribute('data-title', this.__title)
    element.className = `admonition admonition-${this.__admonitionType}`
    return { element }
  }

  // Structure / behaviour ----------------------------------------------------

  isShadowRoot(): boolean {
    return true
  }

  isInline(): false {
    return false
  }

  canBeEmpty(): boolean {
    // Kept true so an in-flight empty admonition isn't auto-removed mid-edit;
    // the extension's structure transform re-seeds an empty paragraph.
    return true
  }

  canIndent(): false {
    return false
  }

  // View ---------------------------------------------------------------------

  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const key = this.getKey()
    const dom = document.createElement('div')
    dom.setAttribute('data-type', this.__admonitionType)
    dom.setAttribute('data-title', this.__title)
    dom.className = `${config.theme.admonition ?? ''} admonition-${this.__admonitionType}`.trim()

    // Non-editable header chrome: icon + title + edit affordance. Marked
    // contenteditable=false so the caret never lands in it and Lexical's
    // reconciler leaves it alone (managed children go into the slot below).
    const header = document.createElement('div')
    header.className = 'AdmonitionNode__header'
    header.contentEditable = 'false'
    header.setAttribute('data-lexical-admonition-chrome', 'true')

    const icon = document.createElement('span')
    icon.className = 'AdmonitionNode__icon'
    icon.innerHTML = ICON_SVG[this.__admonitionType]

    const titleEl = document.createElement('span')
    titleEl.className = 'AdmonitionNode__title'
    titleEl.textContent = this.__title

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'AdmonitionNode__edit-button'
    editButton.textContent = 'Edit'
    editButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      editor.dispatchCommand(OPEN_ADMONITION_MODAL_COMMAND, { nodeKey: key })
    })

    header.appendChild(icon)
    header.appendChild(titleEl)
    header.appendChild(editButton)

    const content = document.createElement('div')
    content.className = 'AdmonitionNode__content'

    dom.appendChild(header)
    dom.appendChild(content)
    return dom
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    const content = element.querySelector(':scope > .AdmonitionNode__content')
    if (!(content instanceof HTMLElement)) {
      throw new Error('AdmonitionNode: expected a .AdmonitionNode__content slot element')
    }
    return super.getDOMSlot(element).withElement(content)
  }

  updateDOM(prevNode: AdmonitionNode, dom: HTMLElement): boolean {
    const type = this.__admonitionType
    if (type !== prevNode.__admonitionType) {
      dom.className =
        `${dom.className.replace(/admonition-\w+/, '').trim()} admonition-${type}`.trim()
      dom.setAttribute('data-type', type)
      const icon = dom.querySelector(':scope > .AdmonitionNode__header > .AdmonitionNode__icon')
      if (icon != null) {
        icon.innerHTML = ICON_SVG[type]
      }
    }
    if (this.__title !== prevNode.__title) {
      dom.setAttribute('data-title', this.__title)
      const titleEl = dom.querySelector(':scope > .AdmonitionNode__header > .AdmonitionNode__title')
      if (titleEl != null) {
        titleEl.textContent = this.__title
      }
    }
    // Never recreate the DOM — that would drop the header chrome and its
    // click handler. Mutations above are applied in place.
    return false
  }

  // Accessors ----------------------------------------------------------------

  getTitle(): string {
    return this.getLatest().__title
  }

  setTitle(title: string): this {
    const writable = this.getWritable()
    writable.__title = title
    return writable
  }

  getAdmonitionType(): AdmonitionType {
    return this.getLatest().__admonitionType
  }

  setAdmonitionType(admonitionType: AdmonitionType): this {
    const writable = this.getWritable()
    writable.__admonitionType = admonitionType
    return writable
  }

  update(payload: Partial<Pick<AdmonitionAttributes, 'admonitionType' | 'title'>>): void {
    const writable = this.getWritable()
    if (payload.admonitionType != null) {
      writable.__admonitionType = payload.admonitionType
    }
    if (payload.title != null) {
      writable.__title = payload.title
    }
  }
}

export function $createAdmonitionNode({
  admonitionType,
  title,
  key,
}: AdmonitionAttributes): AdmonitionNode {
  return $applyNodeReplacement(new AdmonitionNode(admonitionType, title, key))
}

export function $isAdmonitionNode(node: LexicalNode | null | undefined): node is AdmonitionNode {
  return node instanceof AdmonitionNode
}
