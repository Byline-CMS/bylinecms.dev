/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { DocFrontmatter } from './frontmatter.js'

export interface ResolvedFeatureImage {
  targetCollectionId: string
  targetDocumentId: string
}

export interface BuildDocPayloadArgs {
  frontmatter: DocFrontmatter
  lexicalState: unknown
  featureImage: ResolvedFeatureImage | null
  /** Injectable for tests; defaults to the moment the payload is built. */
  now?: Date
}

/**
 * Assemble the field data for one imported markdown file.
 *
 * `publishedOn` is required by the `docs` collection but absent from the
 * documentation front-matter contract (see `frontmatter.ts`), so the importer
 * supplies the import time. Every versioned write is validated against the
 * collection's declared fields, so an omitted value fails the write outright
 * rather than storing a document without a publication date. A file that wants
 * a specific date still sets `publishedOn:` in its front matter, and an
 * already-imported document keeps whatever Byline holds — see
 * `carryForwardPublishedOn`.
 */
export function buildDocPayload({
  frontmatter,
  lexicalState,
  featureImage,
  now = new Date(),
}: BuildDocPayloadArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: frontmatter.title,
    content: [
      {
        _type: 'richTextBlock',
        richText: lexicalState,
        constrainedWidth: frontmatter.constrainedWidth ?? true,
      },
    ],
    publishedOn: frontmatter.publishedOn ?? now,
  }
  if (frontmatter.summary !== undefined) payload.summary = frontmatter.summary
  if (featureImage) payload.featureImage = featureImage
  return payload
}

/**
 * Preserve the publication date Byline already holds — editorial state wins
 * over the re-imported file.
 *
 * An update writes a whole new version from the payload alone; nothing is
 * merged with the version it supersedes. Deleting the key would therefore
 * store a version without a publication date, which both fails field
 * validation and discards the editorial value. Overwrite it instead.
 */
export function carryForwardPublishedOn(
  payload: Record<string, unknown>,
  document: { fields?: Record<string, unknown> | null }
): void {
  const stored = document.fields?.publishedOn
  if (stored != null) payload.publishedOn = stored
}
