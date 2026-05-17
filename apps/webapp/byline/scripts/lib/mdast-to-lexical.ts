/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * mdast → Lexical SerializedEditorState mapper.
 *
 * Pure, headless-editor-free conversion. The output JSON is shaped to
 * match what the runtime serializer in
 * `apps/webapp/src/ui/byline/components/richtext-lexical/serialize`
 * expects to render (heading.tag, list.tag + list.listType, code
 * children of type 'code-highlight' interspersed with 'linebreak',
 * link.attributes, etc.).
 *
 * Inline format is a bitmask on each text node (Lexical convention) —
 * we accumulate it down the walk so `**_foo_**` collapses to a single
 * text node with format = BOLD | ITALIC instead of nested wrappers.
 */

import type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
  ThematicBreak,
} from 'mdast'

// Lexical inline format bits — kept in sync with
// apps/webapp/src/ui/byline/components/richtext-lexical/serialize/richtext-node-formats.ts
const IS_BOLD = 1
const IS_ITALIC = 1 << 1
const IS_STRIKETHROUGH = 1 << 2
const IS_CODE = 1 << 4

export interface LexicalRoot {
  root: {
    type: 'root'
    children: LexicalNode[]
    direction: 'ltr' | null
    format: ''
    indent: 0
    version: 1
  }
}

interface LexicalNode {
  type: string
  version: number
  children?: LexicalNode[]
  [k: string]: unknown
}

export interface MdastToLexicalWarning {
  kind: 'unsupported-node' | 'dropped-html' | 'dropped-image'
  detail: string
}

export interface MdastToLexicalResult {
  state: LexicalRoot
  warnings: MdastToLexicalWarning[]
}

/**
 * Convert an mdast tree to a Lexical SerializedEditorState. Returns the
 * state alongside a list of warnings (unsupported node types, dropped
 * HTML/image/table nodes) so callers can decide whether to fail the
 * import.
 */
export function mdastToLexical(root: Root): MdastToLexicalResult {
  const warnings: MdastToLexicalWarning[] = []
  const children = walkBlocks(root.children, warnings)
  return {
    state: {
      root: {
        type: 'root',
        children: children.length > 0 ? children : [emptyParagraph()],
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      },
    },
    warnings,
  }
}

function walkBlocks(nodes: Content[], warnings: MdastToLexicalWarning[]): LexicalNode[] {
  const out: LexicalNode[] = []
  for (const node of nodes) {
    const converted = blockNode(node, warnings)
    if (converted) out.push(converted)
  }
  return out
}

function blockNode(node: Content, warnings: MdastToLexicalWarning[]): LexicalNode | null {
  switch (node.type) {
    case 'paragraph':
      return paragraphNode(node, warnings)
    case 'heading':
      return headingNode(node, warnings)
    case 'list':
      return listNode(node, warnings)
    case 'blockquote':
      return blockquoteNode(node, warnings)
    case 'code':
      return codeNode(node)
    case 'thematicBreak':
      return horizontalRuleNode(node)
    case 'html':
      warnings.push({
        kind: 'dropped-html',
        detail: `dropped HTML node: ${truncate((node as { value: string }).value)}`,
      })
      return null
    case 'image':
      warnings.push({
        kind: 'dropped-image',
        detail: `dropped image (alt=${(node as Image).alt ?? ''} url=${(node as Image).url})`,
      })
      return null
    case 'table':
      return tableNode(node as Table, warnings)
    default:
      warnings.push({
        kind: 'unsupported-node',
        detail: `dropped block-level node of type '${(node as { type: string }).type}'`,
      })
      return null
  }
}

function paragraphNode(node: Paragraph, warnings: MdastToLexicalWarning[]): LexicalNode {
  return {
    type: 'paragraph',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    children: walkInlines(node.children, 0, warnings),
  }
}

function headingNode(node: Heading, warnings: MdastToLexicalWarning[]): LexicalNode {
  return {
    type: 'heading',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    tag: `h${node.depth}`,
    children: walkInlines(node.children, 0, warnings),
  }
}

function listNode(node: List, warnings: MdastToLexicalWarning[]): LexicalNode {
  const ordered = node.ordered === true
  const start = ordered ? (node.start ?? 1) : 1
  return {
    type: 'list',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    listType: ordered ? 'number' : 'bullet',
    tag: ordered ? 'ol' : 'ul',
    start,
    children: node.children.map((item, index) =>
      listItemNode(item, ordered ? start + index : index + 1, warnings)
    ),
  }
}

function listItemNode(
  node: ListItem,
  value: number,
  warnings: MdastToLexicalWarning[]
): LexicalNode {
  // mdast wraps list-item content in implicit paragraph(s). Lexical
  // listitem expects inline children directly, so peel single-paragraph
  // wrappers. Nested lists are passed through as block children.
  const children: LexicalNode[] = []
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      children.push(...walkInlines(child.children, 0, warnings))
    } else if (child.type === 'list') {
      children.push(listNode(child, warnings))
    } else {
      const block = blockNode(child as Content, warnings)
      if (block) children.push(block)
    }
  }
  return {
    type: 'listitem',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    value,
    children,
  }
}

function blockquoteNode(node: Blockquote, warnings: MdastToLexicalWarning[]): LexicalNode {
  // Lexical's quote node holds inline children, not blocks. mdast
  // blockquotes wrap paragraphs — flatten single-paragraph blockquotes,
  // and for multi-paragraph quotes inject a linebreak between them.
  const inline: LexicalNode[] = []
  let first = true
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      if (!first) inline.push({ type: 'linebreak', version: 1 })
      inline.push(...walkInlines(child.children, 0, warnings))
      first = false
    } else {
      warnings.push({
        kind: 'unsupported-node',
        detail: `blockquote contained non-paragraph child '${child.type}' — dropped`,
      })
    }
  }
  return {
    type: 'quote',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    children: inline,
  }
}

// Markdown fence shorthands → prism-react-renderer language ids. Prism
// bundles `typescript` / `tsx` / `bash` etc. but not the common shorthand
// forms most authors write. Without normalization the imported language
// is unrecognised and falls back to plain — which is the "imported code
// doesn't highlight until I cut-paste it back" symptom (the editor's
// own CodeNode normalises on insert, which is why the round-trip fixes
// it).
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  jsonc: 'json',
  py: 'python',
  rb: 'ruby',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
}

function normalizeCodeLang(lang: string | null | undefined): string | null {
  if (lang == null) return null
  const trimmed = lang.trim().toLowerCase()
  if (trimmed.length === 0) return null
  return LANG_ALIASES[trimmed] ?? trimmed
}

// @lexical/table's TableCellHeaderStates: NO_STATUS=0, ROW=1, COLUMN=2, BOTH=3.
// Markdown GFM tables only ever produce a ROW header (the first row).
const HEADER_STATE_NONE = 0
const HEADER_STATE_ROW = 1

function tableNode(node: Table, warnings: MdastToLexicalWarning[]): LexicalNode {
  return {
    type: 'table',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    children: node.children.map((row, rowIndex) => tableRowNode(row, rowIndex === 0, warnings)),
  }
}

function tableRowNode(
  row: TableRow,
  isHeaderRow: boolean,
  warnings: MdastToLexicalWarning[]
): LexicalNode {
  return {
    type: 'tablerow',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    children: row.children.map((cell) => tableCellNode(cell, isHeaderRow, warnings)),
  }
}

function tableCellNode(
  cell: TableCell,
  isHeaderRow: boolean,
  warnings: MdastToLexicalWarning[]
): LexicalNode {
  // Lexical's TableCellNode expects block-level children (the editor
  // typing flow inserts a paragraph and writes text into it), so wrap
  // mdast's inline cell content in a single paragraph. Empty cells
  // get an empty paragraph so the node still has structurally valid
  // children.
  const inline = walkInlines(cell.children, 0, warnings)
  return {
    type: 'tablecell',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    headerState: isHeaderRow ? HEADER_STATE_ROW : HEADER_STATE_NONE,
    colSpan: 1,
    rowSpan: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        children: inline,
      },
    ],
  }
}

function codeNode(node: Code): LexicalNode {
  // @lexical/code stores fenced code as a `code` element whose children
  // are `code-highlight` text segments interspersed with `linebreak`s
  // (one per line). At import time we don't tokenize — emit one
  // code-highlight per line and let the runtime re-highlight on render.
  const lines = node.value.split('\n')
  const children: LexicalNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) children.push({ type: 'linebreak', version: 1 })
    if (line.length > 0) {
      children.push({
        type: 'code-highlight',
        version: 1,
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        text: line,
      })
    }
  })
  return {
    type: 'code',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    language: normalizeCodeLang(node.lang),
    children,
  }
}

function horizontalRuleNode(_node: ThematicBreak): LexicalNode {
  return { type: 'horizontalrule', version: 1 }
}

function walkInlines(
  nodes: PhrasingContent[],
  format: number,
  warnings: MdastToLexicalWarning[]
): LexicalNode[] {
  const out: LexicalNode[] = []
  for (const node of nodes) {
    const converted = inlineNode(node, format, warnings)
    if (Array.isArray(converted)) out.push(...converted)
    else if (converted) out.push(converted)
  }
  return out
}

function inlineNode(
  node: PhrasingContent,
  format: number,
  warnings: MdastToLexicalWarning[]
): LexicalNode | LexicalNode[] | null {
  switch (node.type) {
    case 'text':
      return textNode((node as Text).value, format)
    case 'strong':
      return walkInlines((node as Strong).children, format | IS_BOLD, warnings)
    case 'emphasis':
      return walkInlines((node as Emphasis).children, format | IS_ITALIC, warnings)
    case 'delete':
      return walkInlines((node as Delete).children, format | IS_STRIKETHROUGH, warnings)
    case 'inlineCode':
      return textNode((node as InlineCode).value, format | IS_CODE)
    case 'link':
      return linkNode(node as Link, format, warnings)
    case 'break':
      return { type: 'linebreak', version: 1 }
    case 'image':
      warnings.push({
        kind: 'dropped-image',
        detail: `dropped inline image (alt=${(node as Image).alt ?? ''} url=${(node as Image).url})`,
      })
      return null
    case 'html':
      warnings.push({
        kind: 'dropped-html',
        detail: `dropped inline HTML: ${truncate((node as { value: string }).value)}`,
      })
      return null
    default:
      warnings.push({
        kind: 'unsupported-node',
        detail: `dropped inline node of type '${(node as { type: string }).type}'`,
      })
      return null
  }
}

function textNode(text: string, format: number): LexicalNode {
  return {
    type: 'text',
    version: 1,
    detail: 0,
    format,
    mode: 'normal',
    style: '',
    text: collapseSoftNewlines(text),
  }
}

// Hard-wrapped markdown paragraphs (common in `/docs`) leave the
// source newlines inside mdast text values. HTML would normally
// collapse those, but Lexical's editor view treats embedded `\n` as
// visible breaks — paragraphs render with mid-sentence wraps at the
// original 80-char column rather than reflowing to the container.
// Collapse a single newline plus any surrounding horizontal whitespace
// to one space; runs of plain spaces (which the author may have
// chosen) are left alone.
function collapseSoftNewlines(text: string): string {
  return text.replace(/[ \t]*\n[ \t]*/g, ' ')
}

function linkNode(node: Link, format: number, warnings: MdastToLexicalWarning[]): LexicalNode {
  const newTab = node.url.startsWith('http://') || node.url.startsWith('https://')
  return {
    type: 'link',
    version: 2,
    direction: 'ltr',
    format: '',
    indent: 0,
    attributes: {
      linkType: 'custom',
      url: node.url,
      newTab,
      rel: newTab ? 'noopener' : null,
    },
    children: walkInlines(node.children, format, warnings),
  }
}

function emptyParagraph(): LexicalNode {
  return {
    type: 'paragraph',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    children: [],
  }
}

function truncate(s: string, max = 40): string {
  const trimmed = s.trim().replace(/\s+/g, ' ')
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}
