/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { collectImageOccurrences } from './media-ingest.js'
import { parseBodyToMdast } from './parse-markdown.js'

export interface AltTextCandidate {
  /** The markdown file the description came from. */
  file: string
  alt: string
}

export interface AltTextConflict {
  mediaPath: string
  /** Every distinct description found, sorted by source file. */
  candidates: AltTextCandidate[]
}

export interface AltTextSources {
  /** media document path → the single description its markdown agrees on. */
  altByPath: Map<string, string>
  /** Paths described more than one way; no value is offered for these. */
  conflicts: AltTextConflict[]
}

/**
 * Gather `altText` values for media documents from the markdown that
 * introduced each image.
 *
 * Several files may reference one image, and because a media document is keyed
 * by a filename-derived slug, files in different directories can land on the
 * same document. Taking whichever description was scanned first would make the
 * repair depend on filesystem enumeration order, so a slug described two
 * different ways yields no value at all: it is reported as a conflict and left
 * for a person to resolve. Identical descriptions are not a conflict.
 *
 * This reads every image *occurrence* rather than the deduped view ingestion
 * uses: one file can describe the same URL two ways, and collapsing by URL
 * first would hide that disagreement behind whichever occurrence came first.
 *
 * `toMediaPath` is the caller's filename-slug rule, so this agrees with
 * whatever key the importer deduped on.
 */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function collectAltTextSources(
  documents: ReadonlyArray<{ file: string; body: string }>,
  toMediaPath: (url: string) => string
): AltTextSources {
  const found = new Map<string, Map<string, string>>()
  for (const { file, body } of documents) {
    for (const image of collectImageOccurrences(parseBodyToMdast(body))) {
      const alt = image.alt.trim()
      if (alt === '') continue
      const mediaPath = toMediaPath(image.url)
      const byAlt = found.get(mediaPath) ?? new Map<string, string>()
      // Keep the first file to use each distinct wording, so the report names
      // a stable source once the candidates are sorted.
      if (!byAlt.has(alt) || byAlt.get(alt)! > file) byAlt.set(alt, file)
      found.set(mediaPath, byAlt)
    }
  }

  const altByPath = new Map<string, string>()
  const conflicts: AltTextConflict[] = []
  for (const [mediaPath, byAlt] of [...found].sort(([a], [b]) => compare(a, b))) {
    if (byAlt.size === 1) {
      altByPath.set(mediaPath, [...byAlt.keys()][0])
      continue
    }
    conflicts.push({
      mediaPath,
      // Sorted by file and then by text: two descriptions in one file would
      // otherwise be reported in whichever order they happened to appear.
      candidates: [...byAlt]
        .map(([alt, file]) => ({ file, alt }))
        .sort((a, b) => (a.file === b.file ? compare(a.alt, b.alt) : compare(a.file, b.file))),
    })
  }
  return { altByPath, conflicts }
}
