/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Table-of-contents extraction for the docs "On this page" navigator.
 *
 * The headings are derived from the stored Lexical content, **not** scraped
 * from the rendered DOM. `HeadingWithAnchorSerializer`
 * (`@/ui/byline/components/heading-anchor`) derives each heading's `id` by
 * running its flattened text through `formatTextValue`; this module runs the
 * identical pair of functions over the identical nodes, so every entry's
 * `href` matches the id the serializer will emit. That keeps the contents list
 * in the server-rendered payload — no post-hydration measuring pass, and no
 * dependence on render order.
 *
 * Only `h2` and `h3` are collected. `h4`–`h6` render without an anchor link
 * (see `heading-anchor.tsx`), so they are not addressable targets, and a docs
 * page deep enough to need them reads better without them crowding the rail.
 *
 * Pure and React-free, so it runs equally in the route loader and in tests.
 */

import { formatTextValue } from '@byline/core'

import { extractHeadingText } from '@/ui/byline/components/heading-anchor/utils'
import type { PopulatedContentBlock } from '@/lib/content-types'
import type { SerializedLexicalNode } from '@/ui/byline/components/richtext-lexical/serialize/types'

/** Heading levels that earn a place in the contents rail. */
const TOC_TAGS = new Set(['h2', 'h3'])

export interface TocHeading {
  /** Anchor id — matches the `id` rendered by `HeadingWithAnchorSerializer`. */
  id: string
  /** Flattened heading text, used as the rail's label. */
  text: string
  level: 2 | 3
}

/**
 * Collect the linkable headings from a document's content blocks, in document
 * order.
 *
 * Ids collide when two headings share a title (a page with several "Options"
 * sections). The serializer emits the bare slug for every one of them, so the
 * browser resolves such a fragment to the first occurrence. Rather than invent
 * suffixed ids the rendered markup does not carry, the duplicates are dropped
 * from the rail — every remaining entry is guaranteed to land on the heading it
 * names.
 */
export function extractDocHeadings(
  blocks: PopulatedContentBlock[] | null | undefined
): TocHeading[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return []

  const headings: TocHeading[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block._type !== 'richTextBlock') continue

    // The richText field is stored as a Lexical editor state; the block type
    // models it loosely (see `RichTextBlock`), hence the narrowing here.
    const richText = (block as { richText?: unknown }).richText as
      | { root?: { children?: SerializedLexicalNode[] } }
      | undefined

    for (const heading of collectHeadingNodes(richText?.root?.children)) {
      const text = extractHeadingText(heading.children).trim()
      if (text.length === 0) continue

      const id = formatTextValue(text)
      if (id.length === 0 || seen.has(id)) continue

      seen.add(id)
      headings.push({ id, text, level: heading.tag === 'h2' ? 2 : 3 })
    }
  }

  return headings
}

interface HeadingNode {
  tag: string
  children?: SerializedLexicalNode[]
}

/**
 * Walk a Lexical subtree for heading nodes at the levels the rail shows.
 * Headings normally sit at the root, but the walk recurses so headings nested
 * inside a container node (a column layout, an admonition) are still found.
 */
function collectHeadingNodes(nodes: SerializedLexicalNode[] | undefined): HeadingNode[] {
  if (!Array.isArray(nodes)) return []

  const found: HeadingNode[] = []
  for (const node of nodes) {
    if (node.type === 'heading' && typeof node.tag === 'string' && TOC_TAGS.has(node.tag)) {
      found.push({ tag: node.tag, children: node.children })
      continue
    }
    if (node.children != null) {
      found.push(...collectHeadingNodes(node.children))
    }
  }
  return found
}
