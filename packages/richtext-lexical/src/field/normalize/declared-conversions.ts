/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** A serialized Lexical node, as stored. */
export interface SerializedNode {
  type: string
  children?: SerializedNode[]
  [key: string]: unknown
}

/**
 * What a convertible structure CONTAINS, which is what decides a
 * structurally valid replacement for it.
 *
 * - `to-paragraph` — a block holding inline content. Becomes exactly one
 *   paragraph, so two adjacent headings stay two paragraphs and an empty
 *   heading stays an empty paragraph instead of vanishing.
 * - `lift-blocks` — a block holding blocks. Its children are lifted in
 *   place, already block-level and already valid where the parent sat.
 * - `unwrap-inline` — inline content. Its children are lifted inline and
 *   stay inside the paragraph that held them.
 * - `to-text` — a text-carrying leaf whose class is unsupported, such as
 *   a syntax-highlighted code token. Becomes a plain text node with its
 *   text and inline formats intact.
 * - `drop` — removed entirely; neighbours are untouched.
 */
export type ConversionKind = 'to-paragraph' | 'lift-blocks' | 'unwrap-inline' | 'to-text' | 'drop'

/**
 * Serialized types Byline knows to be block-level.
 *
 * Needed because a converted node's children are not always inline: a
 * `listitem` may hold a nested `list`, so turning every item straight
 * into a paragraph would nest a block inside a paragraph.
 */
export const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'quote',
  'code',
  'list',
  'listitem',
  'table',
  'tablerow',
  'tablecell',
  'layout-container',
  'layout-item',
  'admonition',
  'horizontalrule',
  'youtube',
  'vimeo',
])

export function isBlockType(type: string): boolean {
  return BLOCK_TYPES.has(type)
}

/**
 * Serialized types Byline knows to be inline.
 *
 * The counterpart to {@link BLOCK_TYPES}, and the reason both lists
 * exist rather than one: a node's structural role cannot be recovered
 * from its serialized shape. An inline `link` and a block `quote` are
 * both elements with `children`, `direction`, `format` and `indent`, so
 * there is no reliable metadata to infer the role from.
 *
 * A SUPPORTED node can reach this test — it arrives as the child of an
 * unsupported parent being converted — so "not a known block" cannot be
 * read as "inline". A custom block from a downstream site would be
 * wrapped into a paragraph and produce a tree Lexical rejects. When a
 * type appears in neither list its role is unknown, and normalization
 * refuses the document rather than guessing at it.
 */
export const INLINE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'linebreak',
  'tab',
  'link',
  'autolink',
  'mark',
  'overflow',
  'code-highlight',
  'inline-image',
])

export function isInlineType(type: string): boolean {
  return INLINE_TYPES.has(type)
}

export interface DeclaredConversion {
  kind: ConversionKind
  /**
   * Information carried on the node's own properties rather than in its
   * children, which would otherwise be lost silently. Emitted as a
   * leading paragraph for `lift-blocks` (an admonition title becomes the
   * first line) and appended to the text for `unwrap-inline` (a link URL
   * follows its text).
   */
  preserveText?: (node: SerializedNode) => string | undefined
}

const urlText = (node: SerializedNode): string | undefined => {
  const attributes = node.attributes as { url?: unknown } | undefined
  const url = typeof node.url === 'string' ? node.url : attributes?.url
  return typeof url === 'string' && url.length > 0 ? url : undefined
}

/**
 * How each convertible structure degrades when a field does not support
 * it. Type strings are the node classes' own `getType()` values.
 *
 * A type absent from this table has NO conversion and is never guessed
 * at — normalization refuses the document instead. That covers custom
 * nodes from downstream sites as well as inline images and embeds, whose
 * media relations and nested-editor captions cannot survive any
 * structural rewrite.
 */
export const DECLARED_CONVERSIONS = {
  // Blocks holding inline content.
  heading: { kind: 'to-paragraph' },
  quote: { kind: 'to-paragraph' },
  code: { kind: 'to-paragraph' },
  listitem: { kind: 'to-paragraph' },

  // Blocks holding blocks.
  table: { kind: 'lift-blocks' },
  tablerow: { kind: 'lift-blocks' },
  tablecell: { kind: 'lift-blocks' },
  list: { kind: 'lift-blocks' },
  'layout-container': { kind: 'lift-blocks' },
  'layout-item': { kind: 'lift-blocks' },
  admonition: {
    kind: 'lift-blocks',
    preserveText: (node) =>
      typeof node.title === 'string' && node.title.length > 0 ? node.title : undefined,
  },

  // Text-carrying leaves. CodeHighlightNode is a TextNode subclass owned
  // by the same extension as CodeNode, so removing code-highlight
  // unregisters BOTH: without this entry a highlighted code block would
  // be refused rather than adapted, contradicting the promise that code
  // degrades to text.
  'code-highlight': { kind: 'to-text' },

  // Inline content.
  link: { kind: 'unwrap-inline', preserveText: urlText },
  autolink: { kind: 'unwrap-inline', preserveText: urlText },

  // Decorative, with nothing to preserve.
  horizontalrule: { kind: 'drop' },
} as const satisfies Record<string, DeclaredConversion>

export function conversionFor(type: string): DeclaredConversion | undefined {
  return (DECLARED_CONVERSIONS as Record<string, DeclaredConversion | undefined>)[type]
}
