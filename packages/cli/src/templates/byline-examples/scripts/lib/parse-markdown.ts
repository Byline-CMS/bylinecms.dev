/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Markdown body → mdast, with Byline admonition extraction.
 *
 * Plain markdown is parsed with remark-parse + remark-gfm. On top of that
 * we recognise the Docusaurus-style admonition container blocks the editor
 * round-trips:
 *
 *   :::note[Optional Title]
 *   body markdown (paragraphs + inline)
 *   :::
 *
 * The fences are line-based and matched with the *same* regexes as the live
 * editor transformer (`packages/richtext-lexical/src/field/markdown/
 * transformers.ts`), so authored markdown round-trips identically through
 * bulk import and the editor's markdown toggle.
 *
 * Why a line scanner rather than `remark-directive`: remark-directive also
 * recognises inline (`:name`) and leaf (`::name`) directives, which turns
 * ordinary prose like `9:30`, `1:2:3`, or `note:foo` into `textDirective`
 * nodes — silently corrupting colon-bearing technical prose. Restricting
 * recognition to the line-anchored container fence avoids that blast radius
 * entirely and is lossless for every non-admonition character.
 *
 * Each admonition becomes a synthetic `admonitionDirective` mdast node whose
 * `children` are the parsed body blocks. It is consumed by
 * `mdast-to-lexical`'s `blockNode`. The node still carries a `children`
 * array, so the link-rewrite pass traverses into admonition bodies normally.
 */

import type { Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export type AdmonitionType = 'note' | 'tip' | 'warning' | 'danger'

/**
 * Synthetic mdast node for a Byline admonition container. Not a real mdast
 * type — produced here and handled by `mdast-to-lexical`. `title` is the raw
 * text from the opening fence's `[...]` (empty string when absent).
 */
export interface AdmonitionDirective {
  type: 'admonitionDirective'
  admonitionType: AdmonitionType
  title: string
  children: RootContent[]
}

// Mirrors transformers.ts: only the four Docusaurus types start an
// admonition; the optional `[Title]` rides the opening fence.
const ADMONITION_START_RE = /^:::(note|tip|warning|danger)(?:\[([^\]]*)\])?\s*$/
const ADMONITION_END_RE = /^:::\s*$/
// Fenced code-block delimiter — `:::` lines inside a code fence are literal
// content, not admonition fences. (A coarse toggle; remark remains the
// source of truth for the actual code parse.)
const CODE_FENCE_RE = /^\s*(```|~~~)/

function parseSegment(text: string): RootContent[] {
  if (text.trim().length === 0) return []
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root
  return tree.children
}

export function parseBodyToMdast(body: string): Root {
  const lines = body.split('\n')
  const children: RootContent[] = []
  let buffer: string[] = []
  let inCode = false
  let i = 0

  const flushBuffer = (): void => {
    if (buffer.length > 0) {
      children.push(...parseSegment(buffer.join('\n')))
      buffer = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (CODE_FENCE_RE.test(line)) {
      inCode = !inCode
      buffer.push(line)
      i += 1
      continue
    }

    const start = inCode ? null : ADMONITION_START_RE.exec(line)
    if (start) {
      flushBuffer()
      const admonitionType = start[1] as AdmonitionType
      const title = start[2] ?? ''
      const inner: string[] = []
      let innerCode = false
      i += 1
      while (i < lines.length) {
        const bodyLine = lines[i]
        if (CODE_FENCE_RE.test(bodyLine)) {
          innerCode = !innerCode
        } else if (!innerCode && ADMONITION_END_RE.test(bodyLine)) {
          i += 1 // consume the closing fence
          break
        }
        inner.push(bodyLine)
        i += 1
      }
      const node: AdmonitionDirective = {
        type: 'admonitionDirective',
        admonitionType,
        title,
        children: parseSegment(inner.join('\n')),
      }
      children.push(node as unknown as RootContent)
      continue
    }

    buffer.push(line)
    i += 1
  }
  flushBuffer()

  return { type: 'root', children: children as Root['children'] }
}
