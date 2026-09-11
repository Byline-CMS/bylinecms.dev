/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedEditorState } from 'lexical'

import {
  conversionFor,
  isBlockType,
  isInlineType,
  type SerializedNode,
} from './declared-conversions'

export type NormalizeResult =
  | { status: 'unchanged' }
  | { status: 'adapted'; value: SerializedEditorState; convertedTypes: string[] }
  | { status: 'refused'; unsupportedTypes: string[] }

const textNode = (text: string): SerializedNode => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  type: 'text',
  version: 1,
})

/** A plain text node carrying another node's own text and inline formats. */
const textFromNode = (node: SerializedNode): SerializedNode => ({
  detail: typeof node.detail === 'number' ? node.detail : 0,
  format: typeof node.format === 'number' ? node.format : 0,
  mode: typeof node.mode === 'string' ? node.mode : 'normal',
  style: typeof node.style === 'string' ? node.style : '',
  text: typeof node.text === 'string' ? node.text : '',
  type: 'text',
  version: 1,
})

const paragraphNode = (children: SerializedNode[]): SerializedNode => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type: 'paragraph',
  version: 1,
})

/**
 * Adapt a stored value to what an editor can actually accept.
 *
 * Lexical throws `parseEditorState: type "X" + not found` on an
 * unregistered type and the text is unrecoverable, so a field that no
 * longer supports a structure would otherwise open blank and erroring.
 *
 * Only the unsupported nodes are converted. A supported node is copied
 * with its own properties intact — it was already in a valid position in
 * the saved document, so its position is never changed — while its
 * children are still inspected, because a supported parent may hold an
 * unsupported descendant. Re-encoding supported content to fix an
 * unrelated structure is exactly what this must not do: an inline image
 * sitting beside a heading would lose its media relation and its
 * nested-editor caption as collateral.
 *
 * The input is never mutated. Refusal wins over any conversion, so the
 * whole tree is walked before a decision is returned.
 */
export function normalizeValue(
  value: SerializedEditorState,
  supportedTypes: ReadonlySet<string>
): NormalizeResult {
  const converted = new Set<string>()
  const refused = new Set<string>()

  /**
   * Wrap runs of inline nodes in paragraphs, leaving blocks where they
   * are. A converted block's children are not guaranteed to be inline —
   * a `listitem` may hold a nested `list` — so turning the whole lot
   * into one paragraph would nest a block inside a paragraph.
   *
   * A node whose role is in neither list is refused rather than assumed
   * inline: it may be a supported custom block from a downstream site,
   * and wrapping one in a paragraph produces a tree Lexical rejects.
   */
  function groupIntoBlocks(nodes: SerializedNode[]): SerializedNode[] {
    const out: SerializedNode[] = []
    let run: SerializedNode[] = []
    const flush = () => {
      if (run.length > 0) {
        out.push(paragraphNode(run))
        run = []
      }
    }
    for (const node of nodes) {
      if (isInlineType(node.type)) {
        run.push(node)
        continue
      }
      if (!isBlockType(node.type)) {
        // Unknown structural role — do not guess.
        refused.add(node.type)
      }
      flush()
      out.push(node)
    }
    flush()
    return out
  }

  function visit(node: SerializedNode): SerializedNode[] {
    const children = Array.isArray(node.children) ? (node.children as SerializedNode[]) : undefined

    if (node.type === 'root' || supportedTypes.has(node.type)) {
      return children == null ? [node] : [{ ...node, children: children.flatMap(visit) }]
    }

    // Unsupported with no declared conversion: never guessed at.
    const conversion = conversionFor(node.type)
    if (conversion == null) {
      refused.add(node.type)
      return [node]
    }

    converted.add(node.type)
    const preserved = conversion.preserveText?.(node)
    const inner = (children ?? []).flatMap(visit)

    switch (conversion.kind) {
      case 'drop':
        return []

      // One block in, at least one block out — so adjacent blocks stay
      // separate and an empty one stays an empty line. Children are
      // partitioned rather than assumed inline, because a list item may
      // hold a nested list.
      case 'to-paragraph': {
        const children = preserved != null ? [...inner, textNode(` ${preserved}`)] : inner
        const grouped = groupIntoBlocks(children)
        return grouped.length > 0 ? grouped : [paragraphNode([])]
      }

      // A text-carrying leaf keeps its text and inline formats.
      case 'to-text':
        return [textFromNode(node)]

      // Children are already blocks. Preserved text leads as its own
      // paragraph, so an admonition title becomes the first line.
      case 'lift-blocks':
        return preserved != null ? [paragraphNode([textNode(preserved)]), ...inner] : inner

      // Inline content stays inline, inside the paragraph that held it.
      case 'unwrap-inline':
        return preserved != null ? [...inner, textNode(` ${preserved}`)] : inner
    }
  }

  const visited = visit(value.root as unknown as SerializedNode)[0]

  if (refused.size > 0) return { status: 'refused', unsupportedTypes: [...refused] }
  if (converted.size === 0) return { status: 'unchanged' }

  // Lexical rejects an empty root — "setEditorState: the editor state is
  // empty" — and conversion can empty one, for instance a document whose
  // only node was a horizontal rule that this field drops.
  const children = Array.isArray(visited.children) ? visited.children : []
  const nextRoot: SerializedNode = {
    ...visited,
    children: children.length > 0 ? children : [paragraphNode([])],
  }

  return {
    status: 'adapted',
    value: { ...value, root: nextRoot } as unknown as SerializedEditorState,
    convertedTypes: [...converted],
  }
}
