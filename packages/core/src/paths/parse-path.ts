/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { PathParseResult, PathSegment } from './path-types.js'

// ---------------------------------------------------------------------------
// Parsing and serialising field paths.
//
// Parsing is schema-unaware: it recovers structure from text and nothing
// more. In particular it cannot tell a block type from a field name, since
// both are bare identifiers — `resolveDeclarationPath` settles that against
// a field set. Callers that already hold the schema (path *producers*) should
// build segments directly and use the formatters here.
// ---------------------------------------------------------------------------

const INDEX_TOKEN = /^\[(\d+)\]$/
const ID_TOKEN = /^\[id=(.+)\]$/

/**
 * Parse a declaration path: dotted, index-free, block types written as plain
 * segments (`content.photoBlock.gallery.alt`).
 *
 * Every segment comes back as `kind: 'field'`. Item indices are a parse
 * error rather than something silently dropped — a caller writing
 * `files[0].caption` where a declaration is expected has made a category
 * mistake, and saying so is more useful than quietly addressing every item.
 */
export function parseDeclarationPath(path: string): PathParseResult {
  if (path.trim() === '') return { ok: false, reason: 'empty' }
  if (path.includes('[')) return { ok: false, reason: 'index' }
  // A closing bracket with no opener is not an item selector the caller wrote
  // in the wrong dialect — it is a typo, and saying so beats advice about
  // declaration paths not taking indices.
  if (path.includes(']')) return { ok: false, reason: 'malformed' }

  const segments: PathSegment[] = []
  for (const part of path.split('.')) {
    if (part === '') return { ok: false, reason: 'emptySegment' }
    segments.push({ kind: 'field', name: part })
  }
  return { ok: true, segments }
}

/**
 * Parse an instance path: dotted field names with bracket item selectors,
 * either positional (`gallery[1]`) or by stable id (`gallery[id=abc]`).
 *
 * Blocks carry no discriminator here — the addressed item resolves its own
 * `_type` — so a block hop is just the blocks field name followed by an
 * item selector.
 */
export function parseInstancePath(path: string): PathParseResult {
  if (path.trim() === '') return { ok: false, reason: 'empty' }

  const segments: PathSegment[] = []
  for (const part of path.split('.')) {
    if (part === '') return { ok: false, reason: 'emptySegment' }

    const bracket = part.indexOf('[')
    if (bracket === -1) {
      if (part.includes(']')) return { ok: false, reason: 'malformed' }
      segments.push({ kind: 'field', name: part })
      continue
    }

    const name = part.slice(0, bracket)
    if (name === '') return { ok: false, reason: 'emptySegment' }
    segments.push({ kind: 'field', name })

    // One segment may carry several selectors (`items[0][1]` is not produced
    // today, but parsing it costs nothing and beats silently truncating).
    let rest = part.slice(bracket)
    while (rest !== '') {
      const close = rest.indexOf(']')
      if (close === -1) return { ok: false, reason: 'malformed' }
      const token = rest.slice(0, close + 1)
      rest = rest.slice(close + 1)

      const indexMatch = INDEX_TOKEN.exec(token)
      if (indexMatch?.[1] != null) {
        segments.push({ kind: 'index', index: Number.parseInt(indexMatch[1], 10) })
        continue
      }
      const idMatch = ID_TOKEN.exec(token)
      if (idMatch?.[1] != null) {
        segments.push({ kind: 'id', id: idMatch[1] })
        continue
      }
      return { ok: false, reason: 'malformed' }
    }
  }
  return { ok: true, segments }
}

/**
 * Serialise segments as a declaration path. Index and id segments are
 * dropped, so this doubles as the instance → declaration projection when
 * applied to instance segments.
 */
export function formatDeclarationPath(segments: readonly PathSegment[]): string {
  return segments
    .filter((segment) => segment.kind === 'field' || segment.kind === 'blockType')
    .map((segment) => (segment.kind === 'blockType' ? segment.blockType : segment.name))
    .join('.')
}

/** Serialise segments as an instance path, rendering selectors in brackets. */
export function formatInstancePath(segments: readonly PathSegment[]): string {
  let out = ''
  for (const segment of segments) {
    switch (segment.kind) {
      case 'field':
        out += out === '' ? segment.name : `.${segment.name}`
        break
      case 'blockType':
        // Instance paths carry no discriminator; the item knows its own type.
        break
      case 'index':
        out += `[${segment.index}]`
        break
      case 'id':
        out += `[id=${segment.id}]`
        break
    }
  }
  return out
}

/**
 * Drop the item selectors from a path, leaving the declaration it addresses.
 *
 * This is the projection several call sites hand-roll with a regex today.
 * Doing it over segments rather than raw text is what makes it safe: a field
 * legitimately named `0` is a `field` segment and survives, where a
 * string-level `/^\d+$/` filter would silently delete it.
 */
export function toDeclarationSegments(segments: readonly PathSegment[]): readonly PathSegment[] {
  return segments.filter((segment) => segment.kind === 'field' || segment.kind === 'blockType')
}
