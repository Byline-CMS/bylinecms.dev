/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

interface OriginalRange {
  start: number
  end: number
}

export interface SearchNormalization {
  value: string
  originalRange(normalizedStart: number, normalizedEnd: number): OriginalRange
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Search-only NFKC + locale-insensitive lowercase normalization with a compact
 * normalized-to-original offset map. Grapheme-grain processing keeps combining
 * sequences together while mapping compatibility expansions (for example `ﬃ`
 * → `ffi`) back to their original span.
 */
export function normalizeForSearch(original: string): SearchNormalization {
  const normalizedParts: string[] = []
  const originalStarts: number[] = []
  const originalEnds: number[] = []
  const segments = [...graphemeSegmenter.segment(original)]

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment == null) continue
    const originalStart = segment.index
    const originalEnd = segments[index + 1]?.index ?? original.length
    const normalized = segment.segment.normalize('NFKC').toLowerCase()
    normalizedParts.push(normalized)
    for (let offset = 0; offset < normalized.length; offset++) {
      originalStarts.push(originalStart)
      originalEnds.push(originalEnd)
    }
  }

  const value = normalizedParts.join('')
  return {
    value,
    originalRange(normalizedStart, normalizedEnd) {
      if (normalizedStart < 0 || normalizedEnd < normalizedStart || normalizedEnd > value.length) {
        throw new RangeError(
          `Normalized range ${normalizedStart}..${normalizedEnd} is outside 0..${value.length}`
        )
      }
      if (normalizedStart === normalizedEnd) {
        const boundary =
          originalStarts[normalizedStart] ?? originalEnds[normalizedStart - 1] ?? original.length
        return { start: boundary, end: boundary }
      }
      return {
        start: originalStarts[normalizedStart] ?? original.length,
        end: originalEnds[normalizedEnd - 1] ?? original.length,
      }
    },
  }
}
