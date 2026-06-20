/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Frontmatter contract for `byline/scripts/import-docs.ts`.
 *
 * Required:  title
 * Optional:  path, summary, status, locale, publishedOn, featureImage,
 *            constrainedWidth
 *
 * Titles are plain prose strings — no markdown formatting (no backticks,
 * no emphasis). The body's leading H1 may carry inline formatting; the
 * importer strips that H1 when its flattened text matches `title`, so
 * a frontmatter title of `Client SDK (@byline/client)` correctly elides
 * an `# Client SDK (\`@byline/client\`)` H1.
 *
 * Unknown keys are an error — typos in frontmatter would otherwise
 * silently no-op.
 */

import matter from 'gray-matter'

const KNOWN_KEYS = new Set([
  'title',
  'path',
  'summary',
  'status',
  'locale',
  'publishedOn',
  'featureImage',
  'constrainedWidth',
])

const ALLOWED_STATUSES = new Set(['draft', 'needs_review', 'published', 'archived'])

export interface DocFrontmatter {
  title: string
  path?: string
  summary?: string
  status?: 'draft' | 'needs_review' | 'published' | 'archived'
  locale?: string
  publishedOn?: Date
  featureImage?: string
  constrainedWidth?: boolean
}

export interface ParsedDoc {
  frontmatter: DocFrontmatter
  body: string
  rawFrontmatter: Record<string, unknown>
}

export function parseDocFile(source: string, filePath: string): ParsedDoc {
  const parsed = matter(source)
  const data = parsed.data as Record<string, unknown>

  const unknown = Object.keys(data).filter((k) => !KNOWN_KEYS.has(k))
  if (unknown.length > 0) {
    throw new Error(
      `${filePath}: unknown frontmatter keys: ${unknown.join(', ')}. ` +
        `Allowed: ${[...KNOWN_KEYS].join(', ')}.`
    )
  }

  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    throw new Error(`${filePath}: frontmatter is missing required 'title' string.`)
  }

  const fm: DocFrontmatter = { title: data.title.trim() }

  if (data.path !== undefined) {
    if (typeof data.path !== 'string' || data.path.trim().length === 0) {
      throw new Error(`${filePath}: 'path' must be a non-empty string when provided.`)
    }
    fm.path = data.path.trim()
  }

  if (data.summary !== undefined) {
    if (typeof data.summary !== 'string') {
      throw new Error(`${filePath}: 'summary' must be a string.`)
    }
    fm.summary = data.summary
  }

  // `status` is overloaded: a workflow status (draft / published / …) is an
  // import directive, but Byline's own design docs also use `status:` for
  // *descriptive* metadata (e.g. "PARTIALLY IMPLEMENTED — …"). Treat a value
  // that isn't a workflow status as descriptive — ignore it for import (the
  // file falls back to the default import status) rather than rejecting the
  // whole file. Only a workflow status is carried through as a directive.
  if (typeof data.status === 'string' && ALLOWED_STATUSES.has(data.status)) {
    fm.status = data.status as DocFrontmatter['status']
  }

  if (data.locale !== undefined) {
    if (typeof data.locale !== 'string' || data.locale.trim().length === 0) {
      throw new Error(`${filePath}: 'locale' must be a non-empty string.`)
    }
    fm.locale = data.locale.trim()
  }

  if (data.publishedOn !== undefined) {
    const d =
      data.publishedOn instanceof Date ? data.publishedOn : new Date(String(data.publishedOn))
    if (Number.isNaN(d.getTime())) {
      throw new Error(`${filePath}: 'publishedOn' is not a valid date.`)
    }
    fm.publishedOn = d
  }

  if (data.featureImage !== undefined) {
    if (typeof data.featureImage !== 'string' || data.featureImage.trim().length === 0) {
      throw new Error(`${filePath}: 'featureImage' must be a non-empty string (a media path).`)
    }
    fm.featureImage = data.featureImage.trim()
  }

  if (data.constrainedWidth !== undefined) {
    if (typeof data.constrainedWidth !== 'boolean') {
      throw new Error(`${filePath}: 'constrainedWidth' must be a boolean.`)
    }
    fm.constrainedWidth = data.constrainedWidth
  }

  return {
    frontmatter: fm,
    body: parsed.content,
    rawFrontmatter: data,
  }
}
