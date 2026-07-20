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

import type { ResolvedImage } from './media-ingest.js'
import type { AdmonitionDirective } from './parse-markdown.js'

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

export interface MdastToLexicalOptions {
  /**
   * Images already ingested into the `media` collection, keyed by the URL
   * as written in the markdown source (see `lib/media-ingest.ts`). A URL
   * absent from the map is dropped with a `dropped-image` warning, which is
   * the behaviour for every image before ingestion existed.
   */
  images?: ReadonlyMap<string, ResolvedImage>
}

/**
 * Walk state threaded through the conversion: the warning accumulator plus
 * the resolved-image lookup. Bundled into one object so adding context
 * doesn't mean re-threading every recursive call signature.
 */
interface ConvertContext {
  warnings: MdastToLexicalWarning[]
  images: ReadonlyMap<string, ResolvedImage>
}

/**
 * Convert an mdast tree to a Lexical SerializedEditorState. Returns the
 * state alongside a list of warnings (unsupported node types, dropped
 * HTML/image/table nodes) so callers can decide whether to fail the
 * import.
 */
export function mdastToLexical(
  root: Root,
  options: MdastToLexicalOptions = {}
): MdastToLexicalResult {
  const ctx: ConvertContext = { warnings: [], images: options.images ?? new Map() }
  const children = walkBlocks(root.children, ctx)
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
    warnings: ctx.warnings,
  }
}

function walkBlocks(nodes: Content[], ctx: ConvertContext): LexicalNode[] {
  const out: LexicalNode[] = []
  for (const node of nodes) {
    const converted = blockNode(node, ctx)
    if (converted) out.push(converted)
  }
  return out
}

function blockNode(node: Content, ctx: ConvertContext): LexicalNode | null {
  // Synthetic admonition container injected by `parse-markdown` — handled
  // ahead of the mdast switch since it isn't a real mdast node type.
  if ((node as { type: string }).type === 'admonitionDirective') {
    return admonitionNode(node as unknown as AdmonitionDirective, ctx)
  }
  switch (node.type) {
    case 'paragraph':
      return paragraphNode(node, ctx)
    case 'heading':
      return headingNode(node, ctx)
    case 'list':
      return listNode(node, ctx)
    case 'blockquote':
      return blockquoteNode(node, ctx)
    case 'code':
      return codeNode(node)
    case 'thematicBreak':
      return horizontalRuleNode(node)
    case 'html':
      ctx.warnings.push({
        kind: 'dropped-html',
        detail: `dropped HTML node: ${truncate((node as { value: string }).value)}`,
      })
      return null
    case 'image': {
      // An image as a direct root child is rare — markdown normally wraps a
      // standalone image in a paragraph. `InlineImageNode` is an inline
      // decorator (`DecoratorNode.isInline()` is true), so it can never be a
      // root child: wrap it the way the editor would.
      const image = inlineImageNode(node as Image, ctx)
      if (!image) return null
      return {
        type: 'paragraph',
        version: 1,
        direction: 'ltr',
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        children: [image],
      }
    }
    case 'table':
      return tableNode(node as Table, ctx)
    default:
      ctx.warnings.push({
        kind: 'unsupported-node',
        detail: `dropped block-level node of type '${(node as { type: string }).type}'`,
      })
      return null
  }
}

function paragraphNode(node: Paragraph, ctx: ConvertContext): LexicalNode {
  return {
    type: 'paragraph',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    children: walkInlines(node.children, 0, ctx),
  }
}

function headingNode(node: Heading, ctx: ConvertContext): LexicalNode {
  return {
    type: 'heading',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    tag: `h${node.depth}`,
    children: walkInlines(node.children, 0, ctx),
  }
}

function listNode(node: List, ctx: ConvertContext): LexicalNode {
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
      listItemNode(item, ordered ? start + index : index + 1, ctx)
    ),
  }
}

function listItemNode(node: ListItem, value: number, ctx: ConvertContext): LexicalNode {
  // mdast wraps list-item content in implicit paragraph(s). Lexical
  // listitem expects inline children directly, so peel single-paragraph
  // wrappers. Nested lists are passed through as block children.
  const children: LexicalNode[] = []
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      children.push(...walkInlines(child.children, 0, ctx))
    } else if (child.type === 'list') {
      children.push(listNode(child, ctx))
    } else {
      const block = blockNode(child as Content, ctx)
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

function blockquoteNode(node: Blockquote, ctx: ConvertContext): LexicalNode {
  // Lexical's quote node holds inline children, not blocks. mdast
  // blockquotes wrap paragraphs — flatten single-paragraph blockquotes,
  // and for multi-paragraph quotes inject a linebreak between them.
  const inline: LexicalNode[] = []
  let first = true
  for (const child of node.children) {
    if (child.type === 'paragraph') {
      if (!first) inline.push({ type: 'linebreak', version: 1 })
      inline.push(...walkInlines(child.children, 0, ctx))
      first = false
    } else {
      ctx.warnings.push({
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

// Byline admonition (callout). An ElementNode whose body lives as real
// block children — paragraphs + inline content — matching the editor's
// `AdmonitionNode`. `admonitionType` / `title` ride the node, not the body.
function admonitionNode(node: AdmonitionDirective, ctx: ConvertContext): LexicalNode {
  const children = walkBlocks(node.children as Content[], ctx)
  // Never leave the body empty — mirrors the editor transformer, which
  // seeds an empty paragraph so the caret has somewhere to land.
  if (children.length === 0) children.push(emptyParagraph())
  return {
    type: 'admonition',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    admonitionType: node.admonitionType,
    title: node.title,
    children,
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

// Default for unfenced / language-less code blocks. Prism crashes on
// null/undefined languages, and the project's docs are predominantly
// TypeScript, so fall back to that rather than 'plain'.
const DEFAULT_CODE_LANG = 'typescript'

function normalizeCodeLang(lang: string | null | undefined): string {
  if (lang == null) return DEFAULT_CODE_LANG
  const trimmed = lang.trim().toLowerCase()
  if (trimmed.length === 0) return DEFAULT_CODE_LANG
  return LANG_ALIASES[trimmed] ?? trimmed
}

// @lexical/table's TableCellHeaderStates: NO_STATUS=0, ROW=1, COLUMN=2, BOTH=3.
// Markdown GFM tables only ever produce a ROW header (the first row).
const HEADER_STATE_NONE = 0
const HEADER_STATE_ROW = 1

function tableNode(node: Table, ctx: ConvertContext): LexicalNode {
  return {
    type: 'table',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    children: node.children.map((row, rowIndex) => tableRowNode(row, rowIndex === 0, ctx)),
  }
}

function tableRowNode(row: TableRow, isHeaderRow: boolean, ctx: ConvertContext): LexicalNode {
  return {
    type: 'tablerow',
    version: 1,
    direction: 'ltr',
    format: '',
    indent: 0,
    children: row.children.map((cell) => tableCellNode(cell, isHeaderRow, ctx)),
  }
}

function tableCellNode(cell: TableCell, isHeaderRow: boolean, ctx: ConvertContext): LexicalNode {
  // Lexical's TableCellNode expects block-level children (the editor
  // typing flow inserts a paragraph and writes text into it), so wrap
  // mdast's inline cell content in a single paragraph. Empty cells
  // get an empty paragraph so the node still has structurally valid
  // children.
  const inline = walkInlines(cell.children, 0, ctx)
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

function walkInlines(nodes: PhrasingContent[], format: number, ctx: ConvertContext): LexicalNode[] {
  const out: LexicalNode[] = []
  for (const node of nodes) {
    const converted = inlineNode(node, format, ctx)
    if (Array.isArray(converted)) out.push(...converted)
    else if (converted) out.push(converted)
  }
  return out
}

function inlineNode(
  node: PhrasingContent,
  format: number,
  ctx: ConvertContext
): LexicalNode | LexicalNode[] | null {
  switch (node.type) {
    case 'text':
      return textNode((node as Text).value, format)
    case 'strong':
      return walkInlines((node as Strong).children, format | IS_BOLD, ctx)
    case 'emphasis':
      return walkInlines((node as Emphasis).children, format | IS_ITALIC, ctx)
    case 'delete':
      return walkInlines((node as Delete).children, format | IS_STRIKETHROUGH, ctx)
    case 'inlineCode':
      return textNode((node as InlineCode).value, format | IS_CODE)
    case 'link':
      return linkNode(node as Link, format, ctx)
    case 'break':
      return { type: 'linebreak', version: 1 }
    case 'image':
      return inlineImageNode(node as Image, ctx)
    case 'html':
      ctx.warnings.push({
        kind: 'dropped-html',
        detail: `dropped inline HTML: ${truncate((node as { value: string }).value)}`,
      })
      return null
    default:
      ctx.warnings.push({
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

/**
 * Markdown image → the richtext package's `InlineImageNode`, at
 * `position: 'full'`. Markdown carries no sizing or float intent, so every
 * imported image is full-width; `width` / `height` come from the ingested
 * media document and act as render-state fallback until the server-side
 * populate visitor refreshes `document`.
 *
 * An unresolved URL (ingestion failed, or the pre-pass didn't run) keeps the
 * pre-existing drop-with-a-warning behaviour rather than emitting a node
 * pointing at nothing.
 */
function inlineImageNode(node: Image, ctx: ConvertContext): LexicalNode | null {
  const resolved = ctx.images.get(node.url)
  if (!resolved) {
    ctx.warnings.push({
      kind: 'dropped-image',
      detail: `dropped image (alt=${node.alt ?? ''} url=${node.url}) — not in the media collection`,
    })
    return null
  }
  return {
    type: 'inline-image',
    version: 1,
    targetDocumentId: resolved.targetDocumentId,
    targetCollectionId: resolved.targetCollectionId,
    targetCollectionPath: resolved.targetCollectionPath,
    src: resolved.src,
    altText: node.alt ?? '',
    position: 'full',
    width: resolved.width,
    height: resolved.height,
    showCaption: false,
    // `InlineImageNode.importJSON` reads `caption.editorState` and only
    // applies it when non-empty, so a childless root leaves the node's own
    // fresh nested editor untouched.
    caption: {
      editorState: {
        root: {
          type: 'root',
          children: [],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      },
    },
  }
}

function linkNode(node: Link, format: number, ctx: ConvertContext): LexicalNode {
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
    children: walkInlines(node.children, format, ctx),
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
