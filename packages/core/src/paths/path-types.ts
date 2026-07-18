/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from '../@types/index.js'

// ---------------------------------------------------------------------------
// One AST for every field path Byline addresses a field with.
//
// Byline's path notations divide into two categories, distinguished by what
// they address:
//
//   * INSTANCE paths address a value in one item of one document. Item
//     indices are required. A block type is redundant — the addressed item
//     carries its own `_type`.
//     Example: `content[0].gallery[1].alt`
//
//   * DECLARATION paths address a field declaration in the schema. There are
//     no indices. A block type IS required — without it, two blocks in the
//     same field declaring the same field name are indistinguishable.
//     Example: `content.photoBlock.gallery.alt`
//
// Both serialise from the same segment list; they differ only in which
// segment kinds may appear and how each renders.
// ---------------------------------------------------------------------------

/**
 * One step along a field path.
 *
 * `field` and `blockType` are indistinguishable in source text — both are
 * bare identifiers. Parsing is schema-unaware and therefore produces only
 * `field` segments; `resolveDeclarationPath` reclassifies them against a
 * field set. Producers walking a schema (see `walkFieldDeclarations`) know
 * the difference and emit the correct kind directly.
 */
export type PathSegment =
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'blockType'; readonly blockType: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'id'; readonly id: string }

/** Why a path string failed to parse. */
export type PathParseFailure =
  /** The whole path was empty or whitespace. */
  | 'empty'
  /** A segment between dots was empty (`a..b`, `.a`, `a.`). */
  | 'emptySegment'
  /** A declaration path carried an item index (`files[0].caption`). */
  | 'index'
  /** Bracket syntax present but unparseable (`a[`, `a[]`, `a[x]`). */
  | 'malformed'

export type PathParseResult =
  | { readonly ok: true; readonly segments: readonly PathSegment[] }
  | { readonly ok: false; readonly reason: PathParseFailure }

/**
 * Outcome of resolving a declaration path against a field set.
 *
 * `blocks` is distinct from `unresolved` because the two warrant different
 * guidance: a path that correctly names a block type but is used where block
 * traversal is barred should point the author at the `blockAdmin` registry,
 * not tell them their path is wrong.
 */
export type PathResolution =
  /** Resolved to a field declaration. `segments` carry block types correctly classified. */
  | {
      readonly status: 'ok'
      readonly field: Field
      readonly segments: readonly PathSegment[]
    }
  /** Traversal reached a `blocks` field while `blocks: 'forbidden'` was in effect. */
  | { readonly status: 'blocks'; readonly at: number }
  /** A segment named nothing, or a value field appeared mid-path. */
  | { readonly status: 'unresolved'; readonly at: number }

export interface ResolveOptions {
  /**
   * How to treat a `blocks` field encountered mid-path.
   *
   * - `'qualified'` (default) — descend, consuming the next segment as a
   *   block type. This is the grammar's normal behaviour, used by the upload
   *   hook registry.
   * - `'forbidden'` — stop and report `status: 'blocks'`. Used by the admin
   *   `fields{}` maps, where per-field overrides inside a block belong to the
   *   blockType-keyed `blockAdmin` registry so that one registration applies
   *   wherever the block renders.
   */
  readonly blocks?: 'qualified' | 'forbidden'
}
