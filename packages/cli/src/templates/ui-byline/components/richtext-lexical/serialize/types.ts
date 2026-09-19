/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedRootNode as LexicalSerializedRootNode } from '@byline/richtext-lexical'

/**
 * Root of a Lexical editor state — `editorState.root` from a persisted
 * document. Matches Lexical's package shape directly so callers can
 * pass `editorState.root.children` straight in without casting.
 */
export interface SerializedLexicalEditorState {
  root: LexicalSerializedRootNode
}

/**
 * Serializer-side node shape for the dispatch in `serialize/index.tsx`.
 *
 * Lexical's package type only guarantees `{ type, version }` on the
 * base; concrete node types (text, element, decorator, custom Byline
 * nodes) carry many more fields. The dispatcher narrows by
 * `node.type` and each `case` reaches into branch-specific fields —
 * we keep the most common ones declared as optional (so reads are
 * shape-aware where they can be) and an `[other: string]: any` escape
 * hatch for fields specific to custom nodes (`tag`, `listType`,
 * `checked`, `attributes`, `headerState`, `kind`, etc.) without
 * enumerating every node type.
 *
 * Deliberately standalone rather than an intersection with Lexical's
 * `SerializedLexicalNode`. Lexical 0.51 types a nested editor's children —
 * an inline image's caption, say — as `SerializedPartialNode[]`, whose
 * `version` and `$slots` relax because a compact export omits what parsing
 * restores on its own. Intersecting with the strict type reimposes those
 * requirements at every depth (`$slots` recurses), which would reject the
 * partial form over properties this dispatcher never reads and force a cast
 * at every nested-editor call site.
 *
 * The open index signature is what makes both flavours assignable, so
 * strict and partial nodes alike flow through the dispatcher without casts.
 */
export type SerializedLexicalNode = {
  type: string
  /** @deprecated Lexical writes it, nothing reads it; a compact export omits it. */
  version?: number
  format?: number | string
  text?: string
  mode?: string
  style?: string
  indent?: string | number
  direction?: 'ltr' | 'rtl' | null
  children?: SerializedLexicalNode[]
  [other: string]: any
}
