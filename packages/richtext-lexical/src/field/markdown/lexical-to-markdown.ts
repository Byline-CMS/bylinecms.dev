/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * One-way Lexical → markdown serializer for the agent-readable export
 * surface (`.md` routes, `llms.txt` — see docs/TODO.md → markdown export).
 *
 * Walks the **stored** `SerializedEditorState` JSON directly — no
 * `@lexical/headless`, no DOM, no node registration. Output is read-only
 * and never re-imported, so *lossy is acceptable* by design: layout
 * columns flatten to stacked sections, video embeds become links,
 * underline/highlight/sub/superscript inline formats are dropped.
 *
 * This is deliberately NOT the editor's markdown source toggle
 * (`./transformers.ts` / `BYLINE_TRANSFORMERS`), which needs bidirectional,
 * lossless `:::`-dialect transformers running inside a Lexical editor.
 * One asymmetry to know about: admonitions export as GFM alerts
 * (`> [!NOTE]`), while the editor toggle and the docs importer
 * (`apps/webapp/byline/scripts/lib/parse-markdown.ts`) speak the
 * Docusaurus `:::type[Title]` dialect. GFM alerts are what GitHub,
 * agents, and most renderers understand — the export optimises for them.
 *
 * Node coverage mirrors the render serializer
 * (`apps/webapp/src/ui/byline/components/richtext-lexical/serialize/`):
 * paragraph, heading, list (bullet/number/check, nested), quote, code
 * (+ code-highlight/linebreak children), table (GFM pipes), link/autolink
 * (custom + internal), horizontalrule, linebreak, text (format bitmask),
 * admonition, inline-image (+ nested caption editor), youtube, vimeo,
 * layout-container/layout-item (flattened). Unknown node types emit a
 * warning and serialize their children, so new nodes degrade gracefully
 * instead of disappearing.
 */

// Text format bitmask — Lexical convention, kept in sync with the render
// serializer's richtext-node-formats.ts and the importer's mdast mapper.
const IS_BOLD = 1
const IS_ITALIC = 1 << 1
const IS_STRIKETHROUGH = 1 << 2
// IS_UNDERLINE (1 << 3), IS_SUBSCRIPT (1 << 5), IS_SUPERSCRIPT (1 << 6),
// IS_HIGHLIGHT (1 << 7) have no portable markdown form — dropped (lossy-OK).
const IS_CODE = 1 << 4

type AnyNode = {
  type?: string
  children?: AnyNode[]
  [k: string]: unknown
}

export interface LexicalToMarkdownWarning {
  kind: 'unknown-node' | 'unresolved-link' | 'empty-table'
  detail: string
}

export interface LexicalToMarkdownOptions {
  /**
   * Resolve an internal-link / inline-image relation to a public URL.
   * Receives the node's flattened relation attributes (`targetCollectionPath`,
   * `document.path`, …). Return `undefined` to fall back to the default
   * `/${targetCollectionPath}/${document.path}` composition; the link is
   * dropped (children kept) when no URL can be derived at all.
   */
  resolveInternalUrl?: (attrs: {
    targetDocumentId?: string
    targetCollectionPath?: string
    documentPath?: string
  }) => string | undefined
}

export interface LexicalToMarkdownResult {
  markdown: string
  warnings: LexicalToMarkdownWarning[]
}

/** GFM alert labels per Byline admonition type. */
const ADMONITION_TO_GFM: Record<string, string> = {
  note: 'NOTE',
  tip: 'TIP',
  warning: 'WARNING',
  danger: 'CAUTION',
}

/**
 * Serialize a stored Lexical `SerializedEditorState` (or its `root`) to a
 * markdown string. Accepts the value as `unknown` because richtext leaves
 * arrive untyped from storage; non-richtext shapes return an empty string.
 */
export function lexicalToMarkdown(
  state: unknown,
  options: LexicalToMarkdownOptions = {}
): LexicalToMarkdownResult {
  const warnings: LexicalToMarkdownWarning[] = []
  const root = resolveRoot(state)
  if (root == null) return { markdown: '', warnings }
  const blocks = serializeBlocks(root.children ?? [], { options, warnings })
  return { markdown: joinBlocks(blocks), warnings }
}

interface Ctx {
  options: LexicalToMarkdownOptions
  warnings: LexicalToMarkdownWarning[]
}

function resolveRoot(state: unknown): AnyNode | null {
  if (state == null) return null
  let value: unknown = state
  // Tolerate stringified editor state (older rows / defensive).
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  const root = (obj.root ?? obj) as AnyNode
  return root.type === 'root' ? root : null
}

/** Serialize a list of block-level nodes; empty results are dropped. */
function serializeBlocks(nodes: AnyNode[], ctx: Ctx): string[] {
  const out: string[] = []
  for (const node of nodes) {
    const block = serializeBlock(node, ctx)
    if (block != null && block.length > 0) out.push(block)
  }
  return out
}

function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n')
}

function serializeBlock(node: AnyNode, ctx: Ctx): string | null {
  switch (node.type) {
    case 'paragraph': {
      const text = serializeInline(node.children ?? [], ctx)
      return text.trim().length > 0 ? text : null
    }
    case 'heading': {
      const tag = typeof node.tag === 'string' ? node.tag : 'h2'
      const level = Math.min(Math.max(Number(tag.slice(1)) || 2, 1), 6)
      return `${'#'.repeat(level)} ${serializeInline(node.children ?? [], ctx)}`
    }
    case 'list':
      return serializeList(node, ctx, 0)
    case 'quote': {
      const inner = serializeInline(node.children ?? [], ctx)
      return prefixLines(inner, '> ')
    }
    case 'code':
      return serializeCode(node)
    case 'table':
      return serializeTable(node, ctx)
    case 'horizontalrule':
      return '---'
    case 'admonition':
      return serializeAdmonition(node, ctx)
    case 'youtube':
      return typeof node.videoID === 'string' && node.videoID.length > 0
        ? `[YouTube video](https://www.youtube.com/watch?v=${node.videoID})`
        : null
    case 'vimeo':
      return typeof node.videoID === 'string' && node.videoID.length > 0
        ? `[Vimeo video](https://vimeo.com/${node.videoID})`
        : null
    case 'layout-container':
      // Columns flatten to stacked sections (lossy-OK by design).
      return joinBlocks(serializeBlocks(node.children ?? [], ctx))
    case 'layout-item':
      return joinBlocks(serializeBlocks(node.children ?? [], ctx))
    case 'inline-image':
      // An image can appear at block position (sole child of the root).
      return serializeImage(node, ctx)
    default: {
      if (node.children && node.children.length > 0) {
        ctx.warnings.push({
          kind: 'unknown-node',
          detail: `unknown block node '${node.type ?? '?'}' — serialized children only`,
        })
        return joinBlocks(serializeBlocks(node.children, ctx))
      }
      ctx.warnings.push({
        kind: 'unknown-node',
        detail: `unknown leaf node '${node.type ?? '?'}' — dropped`,
      })
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function serializeList(node: AnyNode, ctx: Ctx, depth: number): string {
  const listType = node.listType === 'number' ? 'number' : node.listType
  const lines: string[] = []
  let ordinal = 1
  for (const item of node.children ?? []) {
    if (item.type !== 'listitem') continue
    // A list item whose children include a nested list renders the nested
    // list on subsequent indented lines.
    const inlineChildren = (item.children ?? []).filter((c) => c.type !== 'list')
    const nestedLists = (item.children ?? []).filter((c) => c.type === 'list')

    const marker =
      listType === 'number'
        ? `${ordinal}. `
        : listType === 'check'
          ? `- [${item.checked === true ? 'x' : ' '}] `
          : '- '
    ordinal += 1

    const text = serializeInline(inlineChildren, ctx)
    const indent = '  '.repeat(depth)
    if (text.trim().length > 0 || nestedLists.length === 0) {
      lines.push(`${indent}${marker}${text}`)
    }
    for (const nested of nestedLists) {
      lines.push(serializeList(nested, ctx, depth + 1))
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

function serializeCode(node: AnyNode): string {
  const language = typeof node.language === 'string' ? node.language : ''
  const parts: string[] = []
  for (const child of node.children ?? []) {
    if (child.type === 'linebreak') {
      parts.push('\n')
    } else if (typeof child.text === 'string') {
      // code-highlight and plain text children both carry `.text`.
      parts.push(child.text)
    }
  }
  const body = parts.join('')
  // Grow the fence beyond any backtick run inside the code itself.
  const longestRun = body.match(/`+/g)?.reduce((m, r) => Math.max(m, r.length), 0) ?? 0
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${body}\n${fence}`
}

// ---------------------------------------------------------------------------
// Tables (GFM pipes)
// ---------------------------------------------------------------------------

function serializeTable(node: AnyNode, ctx: Ctx): string | null {
  const rows = (node.children ?? []).filter((c) => c.type === 'tablerow')
  if (rows.length === 0) {
    ctx.warnings.push({ kind: 'empty-table', detail: 'table with no rows dropped' })
    return null
  }
  const toCells = (row: AnyNode): string[] =>
    (row.children ?? [])
      .filter((c) => c.type === 'tablecell')
      .map((cell) =>
        serializeInline(cell.children ?? [], ctx)
          .replace(/\|/g, '\\|')
          .trim()
      )

  const [first, ...rest] = rows
  const header = toCells(first as AnyNode)
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rest.map((row) => `| ${toCells(row).join(' | ')} |`),
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Admonitions → GFM alerts
// ---------------------------------------------------------------------------

function serializeAdmonition(node: AnyNode, ctx: Ctx): string {
  const gfmType = ADMONITION_TO_GFM[String(node.admonitionType ?? 'note')] ?? 'NOTE'
  const title = typeof node.title === 'string' && node.title.length > 0 ? node.title : null
  const body = joinBlocks(serializeBlocks(node.children ?? [], ctx))
  const parts = [`[!${gfmType}]`]
  if (title) parts.push(`**${title}**`)
  if (body.length > 0) parts.push(body)
  return prefixLines(parts.join('\n\n'), '> ')
}

// ---------------------------------------------------------------------------
// Inline serialization
// ---------------------------------------------------------------------------

function serializeInline(nodes: AnyNode[], ctx: Ctx): string {
  const parts: string[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i] as AnyNode
    switch (node.type) {
      case 'text':
      case 'code-highlight': {
        // Group consecutive text nodes sharing one format so `**bold**`
        // doesn't fragment into `**bo****ld**`.
        const format = Number(node.format ?? 0)
        let text = String(node.text ?? '')
        while (
          i + 1 < nodes.length &&
          (nodes[i + 1] as AnyNode).type === node.type &&
          Number((nodes[i + 1] as AnyNode).format ?? 0) === format
        ) {
          i += 1
          text += String((nodes[i] as AnyNode).text ?? '')
        }
        parts.push(wrapFormats(text, format))
        break
      }
      case 'linebreak':
        parts.push('\\\n')
        break
      case 'link':
      case 'autolink':
        parts.push(serializeLink(node, ctx))
        break
      case 'inline-image':
        parts.push(serializeImage(node, ctx))
        break
      default: {
        if (node.children && node.children.length > 0) {
          parts.push(serializeInline(node.children, ctx))
        } else if (typeof node.text === 'string') {
          parts.push(escapeText(node.text))
        } else {
          ctx.warnings.push({
            kind: 'unknown-node',
            detail: `unknown inline node '${node.type ?? '?'}' — dropped`,
          })
        }
      }
    }
    i += 1
  }
  return parts.join('')
}

function wrapFormats(rawText: string, format: number): string {
  if (rawText.length === 0) return ''
  // Inline code suppresses every other wrapper and is not escaped.
  if (format & IS_CODE) {
    const longestRun = rawText.match(/`+/g)?.reduce((m, r) => Math.max(m, r.length), 0) ?? 0
    const fence = '`'.repeat(longestRun + 1)
    return `${fence}${rawText}${fence}`
  }
  // Markdown emphasis does not survive leading/trailing whitespace inside
  // the markers — hoist it outside.
  const leading = rawText.match(/^\s*/)?.[0] ?? ''
  const trailing = rawText.match(/\s*$/)?.[0] ?? ''
  const core = rawText.slice(leading.length, rawText.length - trailing.length)
  if (core.length === 0) return rawText
  let text = escapeText(core)
  if (format & IS_BOLD) text = `**${text}**`
  if (format & IS_ITALIC) text = `*${text}*`
  if (format & IS_STRIKETHROUGH) text = `~~${text}~~`
  return `${leading}${text}${trailing}`
}

/**
 * Conservative escaping of characters that would otherwise activate
 * markdown syntax mid-sentence. Deliberately light — over-escaping makes
 * the output unreadable, and the export is lossy-by-contract.
 */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

function serializeLink(node: AnyNode, ctx: Ctx): string {
  const attrs = (node.attributes ?? {}) as Record<string, unknown>
  const text = serializeInline(node.children ?? [], ctx)
  const url = resolveLinkUrl(attrs, ctx)
  if (url == null) {
    // Unresolved / unresolvable internal link: keep the text, drop the link.
    return text
  }
  return `[${text}](${url})`
}

function resolveLinkUrl(attrs: Record<string, unknown>, ctx: Ctx): string | null {
  if (attrs.linkType === 'internal') {
    const document = (attrs.document ?? {}) as Record<string, unknown>
    if (document._resolved === false) {
      ctx.warnings.push({
        kind: 'unresolved-link',
        detail: `internal link to ${String(attrs.targetDocumentId ?? '?')} unresolved`,
      })
      return null
    }
    const documentPath = typeof document.path === 'string' ? document.path : undefined
    const custom = ctx.options.resolveInternalUrl?.({
      targetDocumentId:
        typeof attrs.targetDocumentId === 'string' ? attrs.targetDocumentId : undefined,
      targetCollectionPath:
        typeof attrs.targetCollectionPath === 'string' ? attrs.targetCollectionPath : undefined,
      documentPath,
    })
    if (custom != null) return custom
    if (documentPath == null) return null
    if (documentPath.startsWith('/')) return documentPath
    if (typeof attrs.targetCollectionPath === 'string' && attrs.targetCollectionPath.length > 0) {
      return `/${attrs.targetCollectionPath}/${documentPath}`
    }
    return null
  }
  return typeof attrs.url === 'string' && attrs.url.length > 0 ? attrs.url : null
}

function serializeImage(node: AnyNode, ctx: Ctx): string {
  const src = typeof node.src === 'string' ? node.src : ''
  if (src.length === 0) return ''
  const alt = typeof node.altText === 'string' ? node.altText : ''
  const image = `![${alt.replace(/[[\]]/g, '')}](${src})`
  // The caption is a nested SerializedEditor — flatten to emphasized text.
  const caption = node.caption as { editorState?: unknown } | undefined
  if (node.showCaption === true && caption?.editorState != null) {
    const captionRoot = resolveRoot(caption.editorState)
    if (captionRoot != null) {
      const captionText = serializeBlocks(captionRoot.children ?? [], ctx)
        .join(' ')
        .trim()
      if (captionText.length > 0) return `${image}\n*${captionText}*`
    }
  }
  return image
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n')
}
