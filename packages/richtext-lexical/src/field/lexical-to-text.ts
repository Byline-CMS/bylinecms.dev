/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * One-way Lexical → plain-text extractor for search indexing — flattens a
 * stored `SerializedEditorState` to indexable plain text via a recursive
 * text-node accumulator. No markdown syntax, no link URLs, no images: just
 * the words, with paragraph breaks between block-level nodes.
 *
 * Registered through `ServerConfig.fields.richText.toText` (see
 * `lexicalEditorToTextServer` in `../server`) and consumed by core's
 * `buildSearchDocument` to feed a collection's searchable `body`. Walks the
 * stored JSON directly — no editor instantiation, no DOM, no DB reads —
 * exactly like the markdown serializer. Lossy by contract.
 */

type AnyNode = {
  type?: string
  text?: string
  children?: AnyNode[]
  // Nested editor states (admonition body, inline-image caption).
  content?: { editorState?: unknown }
  caption?: { editorState?: unknown }
  title?: string
  altText?: string
  showCaption?: boolean
}

/** Inline node types whose children continue the current paragraph. */
const INLINE_CONTAINER_TYPES = new Set(['link', 'autolink'])

/** Leaf / embed node types that contribute no indexable text. */
const SKIP_TYPES = new Set(['youtube', 'vimeo', 'horizontalrule', 'tab'])

class LexicalTextConverter {
  private paragraphs: string[] = []
  private current = ''

  private addText(text: string | null | undefined): void {
    if (text != null) this.current += text
  }

  private endParagraph(): void {
    const p = this.current.trim()
    if (p.length > 0) this.paragraphs.push(p)
    this.current = ''
  }

  getText(): string {
    this.endParagraph()
    return this.paragraphs.join('\n')
  }

  /** Block-level children: flush before and after so blocks separate. */
  addBlockNodes(nodes: AnyNode[] | null | undefined): void {
    this.endParagraph()
    for (const node of nodes ?? []) this.addNode(node)
    this.endParagraph()
  }

  /** Inline children: continue the current paragraph. */
  private addInlineNodes(nodes: AnyNode[] | null | undefined): void {
    for (const node of nodes ?? []) this.addNode(node)
  }

  private addNode(node: AnyNode): void {
    const type = node.type

    if (type === 'text' || type === 'code-highlight') {
      this.addText(node.text)
      return
    }
    if (type === 'linebreak') {
      this.endParagraph()
      return
    }
    if (type === 'admonition') {
      this.endParagraph()
      this.addText(node.title)
      this.endParagraph()
      this.addText(lexicalToText(node.content?.editorState).trim())
      this.endParagraph()
      return
    }
    if (type === 'inline-image') {
      this.endParagraph()
      this.addText(node.altText)
      if (node.showCaption) {
        this.endParagraph()
        this.addText(lexicalToText(node.caption?.editorState).trim())
      }
      this.endParagraph()
      return
    }
    if (type != null && SKIP_TYPES.has(type)) return

    if (type != null && INLINE_CONTAINER_TYPES.has(type)) {
      this.addInlineNodes(node.children)
      return
    }
    // Default: any node with children is treated as block-level (paragraph,
    // heading, quote, code, list, listitem, table*, layout*, …). Unknown
    // childless nodes contribute nothing.
    if (Array.isArray(node.children)) {
      this.addBlockNodes(node.children)
    }
  }
}

/**
 * Resolve a stored value (a `SerializedEditorState`, its `root`, or a
 * stringified version of either) to the root node, mirroring the markdown
 * serializer's `resolveRoot`.
 */
function resolveRoot(value: unknown): AnyNode | null {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (typeof v !== 'object' || v === null) return null
  const obj = v as { root?: AnyNode } & AnyNode
  const root = (obj.root ?? obj) as AnyNode
  return root.type === 'root' ? root : null
}

/**
 * Extract indexable plain text from a (possibly null / stringified)
 * serialized Lexical editor state. Returns `''` when there is no content.
 */
export function lexicalToText(value: unknown): string {
  const root = resolveRoot(value)
  if (root == null) return ''
  const converter = new LexicalTextConverter()
  converter.addBlockNodes(root.children)
  return converter.getText()
}
