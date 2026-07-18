/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { parseDeclarationPath } from './parse-path.js'
import type { Field } from '../@types/index.js'
import type { PathResolution, PathSegment, ResolveOptions } from './path-types.js'

// ---------------------------------------------------------------------------
// The schema-aware half of the path grammar: walking a field set to produce
// declaration paths, and resolving a declaration path back to the field it
// addresses.
// ---------------------------------------------------------------------------

/**
 * Visit every field declaration in a field set, depth first, handing each one
 * the segments that address it.
 *
 * Structure fields are visited themselves and then descended into. A `blocks`
 * field contributes two segments per hop — its own name and the block type —
 * which is what keeps two blocks declaring the same field name apart.
 *
 * This is the single canonical walk. Producers of declaration paths (the
 * upload hook registry, boot-validation error messages) should use it rather
 * than re-implementing the descent, which is how they drifted apart.
 */
export function walkFieldDeclarations(
  fields: readonly Field[],
  visit: (field: Field, segments: readonly PathSegment[]) => void,
  prefix: readonly PathSegment[] = []
): void {
  for (const field of fields) {
    const segments: PathSegment[] = [...prefix, { kind: 'field', name: field.name }]
    visit(field, segments)

    if (field.type === 'group' || field.type === 'array') {
      walkFieldDeclarations(field.fields, visit, segments)
    } else if (field.type === 'blocks') {
      for (const block of field.blocks) {
        walkFieldDeclarations(block.fields, visit, [
          ...segments,
          { kind: 'blockType', blockType: block.blockType },
        ])
      }
    }
  }
}

/**
 * Resolve a declaration path against a field set.
 *
 * Accepts either a path string or pre-parsed segments. Segments arriving as
 * `kind: 'field'` where the schema expects a block type are reclassified in
 * the returned `segments`, so callers get a correctly typed path back even
 * though the parser could not have known.
 *
 * Item selectors are rejected: a declaration path addresses a declaration, so
 * an index is a category error rather than something to ignore.
 */
export function resolveDeclarationPath(
  fields: readonly Field[],
  path: string | readonly PathSegment[],
  options: ResolveOptions = {}
): PathResolution {
  const allowBlocks = (options.blocks ?? 'qualified') === 'qualified'

  let input: readonly PathSegment[]
  if (typeof path === 'string') {
    const parsed = parseDeclarationPath(path)
    if (!parsed.ok) return { status: 'unresolved', at: 0 }
    input = parsed.segments
  } else {
    input = path
  }
  if (input.length === 0) return { status: 'unresolved', at: 0 }

  const resolved: PathSegment[] = []
  let current: readonly Field[] = fields
  let i = 0

  while (i < input.length) {
    const segment = input[i]
    // Declaration paths carry names only. Anything else is a caller passing
    // instance segments where a declaration was required.
    if (segment == null || (segment.kind !== 'field' && segment.kind !== 'blockType')) {
      return { status: 'unresolved', at: i }
    }
    const name = segment.kind === 'field' ? segment.name : segment.blockType

    const field = current.find((candidate) => candidate.name === name)
    if (field == null) return { status: 'unresolved', at: i }
    resolved.push({ kind: 'field', name: field.name })

    const isLast = i === input.length - 1
    if (isLast) return { status: 'ok', field, segments: resolved }

    if (field.type === 'group' || field.type === 'array') {
      current = field.fields
      i += 1
      continue
    }

    if (field.type === 'blocks') {
      if (!allowBlocks) return { status: 'blocks', at: i }

      // The next segment names the block type — the discriminator that makes
      // the rest of the path unambiguous.
      const next = input[i + 1]
      if (next == null || (next.kind !== 'field' && next.kind !== 'blockType')) {
        return { status: 'unresolved', at: i + 1 }
      }
      const blockType = next.kind === 'field' ? next.name : next.blockType
      const block = field.blocks.find((candidate) => candidate.blockType === blockType)
      if (block == null) return { status: 'unresolved', at: i + 1 }
      resolved.push({ kind: 'blockType', blockType: block.blockType })

      // A path ending on the block type addresses the block, not a field.
      if (i + 1 === input.length - 1) return { status: 'unresolved', at: i + 1 }

      current = block.fields
      i += 2
      continue
    }

    // A value field with path left to walk.
    return { status: 'unresolved', at: i }
  }

  return { status: 'unresolved', at: input.length - 1 }
}
