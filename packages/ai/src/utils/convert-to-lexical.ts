/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedEditorState } from 'lexical'

export type Marks = {
  bold: boolean
  italic: boolean
  underline: boolean
  code: boolean
}

export type InlineText = {
  kind: 'text'
  text: string
  marks: Marks
}

export type InlineLink = {
  kind: 'link'
  url: string
  text: string
  marks: Marks
}

export type InlineBr = {
  kind: 'br'
}

export type Inline = InlineText | InlineLink | InlineBr

export type ParagraphBlock = {
  kind: 'paragraph'
  align: 'start' | 'center' | 'right'
  inlines: Inline[]
}

export type HeadingBlock = {
  kind: 'heading'
  level: 1 | 2 | 3
  inlines: Inline[]
}

export type QuoteBlock = {
  kind: 'quote'
  blocks: ParagraphBlock[]
}

export type HrBlock = {
  kind: 'hr'
}

export type ListItemBlock = {
  indent: 0 | 1
  blocks: ParagraphBlock[]
}

export type ListBlock = {
  kind: 'list'
  listType: 'bullet' | 'number'
  items: ListItemBlock[]
}

export type Block = HeadingBlock | ParagraphBlock | ListBlock | QuoteBlock | HrBlock

export type GeneratedDoc = {
  title: string | null
  blocks: Block[]
}

const DEFAULT_DIRECTION: 'ltr' | null = 'ltr'

const normalizeAlign = (value: unknown): 'start' | 'center' | 'right' => {
  if (value === 'start' || value === 'center' || value === 'right') return value
  if (value === 'left') return 'start'
  return 'start'
}

const marksToTextFormat = (marks: Marks | undefined): number => {
  if (!marks) return 0
  let format = 0
  if (marks.bold) format |= 1
  if (marks.italic) format |= 2
  if (marks.underline) format |= 8
  if (marks.code) format |= 16
  return format
}

const createTextNode = (text: string, marks?: Marks) => {
  return {
    type: 'text',
    text,
    format: marksToTextFormat(marks),
    style: '',
    mode: 0,
    detail: 0,
    direction: DEFAULT_DIRECTION,
    indent: 0,
    version: 1,
  }
}

const createLineBreakNode = () => {
  return {
    type: 'linebreak',
    version: 1,
  }
}

const createLinkNode = (url: string, text: string, marks?: Marks) => {
  return {
    type: 'link',
    url,
    children: [createTextNode(text, marks)],
  }
}

const inlinesToLexicalNodes = (inlines: Inline[]) => {
  const out: any[] = []
  for (const inline of inlines) {
    if (inline.kind === 'text') {
      out.push(createTextNode(inline.text, inline.marks))
      continue
    }

    if (inline.kind === 'link') {
      out.push(createLinkNode(inline.url, inline.text, inline.marks))
      continue
    }

    if (inline.kind === 'br') {
      out.push(createLineBreakNode())
    }
  }
  return out
}

const createParagraphNode = (block: ParagraphBlock) => {
  return {
    type: 'paragraph',
    children: inlinesToLexicalNodes(block.inlines),
    direction: DEFAULT_DIRECTION,
    format: normalizeAlign((block as any).align),
    indent: 0,
    textFormat: 0,
    textStyle: '',
    version: 1,
  }
}

const createHeadingNode = (block: HeadingBlock) => {
  const tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3'
  return {
    type: 'heading',
    children: inlinesToLexicalNodes(block.inlines),
    direction: DEFAULT_DIRECTION,
    indent: 0,
    tag,
    version: 1,
  }
}

const createHorizontalRuleNode = () => {
  return {
    type: 'horizontalrule',
  }
}

const createQuoteNode = (block: QuoteBlock) => {
  return {
    type: 'quote',
    children: block.blocks.map((p) => createParagraphNode(p)),
  }
}

const createListItemNode = (indent: 0 | 1, paragraphs: any[]) => {
  // Keep property order stable: indent -> type -> children
  return {
    indent,
    type: 'listitem',
    children: paragraphs,
  }
}

const createListNode = (listType: 'bullet' | 'number', children: any[]) => {
  return {
    type: 'list',
    children,
    listType,
  }
}

const createEmptyParagraph = () => {
  return {
    type: 'paragraph',
    children: [createTextNode('', { bold: false, italic: false, underline: false, code: false })],
    direction: DEFAULT_DIRECTION,
    format: 'start',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    version: 1,
  }
}

const listBlockToLexicalNode = (block: ListBlock) => {
  const topLevelItems: any[] = []
  let lastTopLevelItem: any | null = null

  for (const item of block.items) {
    const itemParagraphs = (item.blocks ?? []).map((p) => createParagraphNode(p))
    const safeParagraphs = itemParagraphs.length > 0 ? itemParagraphs : [createEmptyParagraph()]

    if (item.indent === 0 || lastTopLevelItem == null) {
      const li = createListItemNode(0, safeParagraphs)
      topLevelItems.push(li)
      lastTopLevelItem = li
      continue
    }

    // indent === 1: nest under the previous top-level list item.
    const parentChildren: any[] = Array.isArray(lastTopLevelItem.children)
      ? lastTopLevelItem.children
      : []
    lastTopLevelItem.children = parentChildren

    let nestedList = parentChildren.find(
      (c) => c && c.type === 'list' && c.listType === block.listType && Array.isArray(c.children)
    )
    if (!nestedList) {
      nestedList = createListNode(block.listType, [])
      parentChildren.push(nestedList)
    }

    nestedList.children.push(createListItemNode(1, safeParagraphs))
  }

  return createListNode(block.listType, topLevelItems)
}

export function convertToLexical(doc: GeneratedDoc): SerializedEditorState {
  const children: any[] = []

  const title = doc.title?.trim() ?? ''
  if (title.length > 0) {
    children.push(
      createHeadingNode({
        kind: 'heading',
        level: 1,
        inlines: [
          {
            kind: 'text',
            text: title,
            marks: { bold: false, italic: false, underline: false, code: false },
          },
        ],
      })
    )
  }

  for (const block of doc.blocks ?? []) {
    if (block.kind === 'heading') {
      children.push(createHeadingNode(block))
      continue
    }
    if (block.kind === 'paragraph') {
      children.push(createParagraphNode(block))
      continue
    }
    if (block.kind === 'list') {
      children.push(listBlockToLexicalNode(block))
      continue
    }
    if (block.kind === 'quote') {
      children.push(createQuoteNode(block))
      continue
    }
    if (block.kind === 'hr') {
      children.push(createHorizontalRuleNode())
    }
  }

  if (children.length === 0) {
    children.push(createEmptyParagraph())
  }

  return {
    root: {
      type: 'root',
      children,
      direction: DEFAULT_DIRECTION,
      indent: 0,
      version: 1,
    },
  } as any
}
