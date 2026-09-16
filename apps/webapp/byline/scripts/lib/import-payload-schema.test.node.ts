/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Schema-level regression coverage for the payloads the import scripts write.
 *
 * The unit tests beside each builder assert its shape; they cannot tell whether
 * that shape satisfies the collection. Every versioned write is validated
 * against the collection's declared fields, so a payload missing a required
 * field fails at the write gate — for `media` only on the first ingest of an
 * image the collection has never seen, which is why an omitted `altText` went
 * unnoticed. These tests run the real `Docs` and `Media` definitions through the
 * same validator the lifecycle uses, so a field added to either schema fails
 * here rather than in production.
 */

import type { StoredFileValue } from '@byline/core'
import { validateDocumentFields } from '@byline/core'
import { describe, expect, test } from 'vitest'

import { Docs } from '../../collections/docs/schema.js'
import { Media } from '../../collections/media/schema.js'
import { buildDocPayload } from './build-doc-payload.js'
import { buildMediaFields } from './media-ingest.js'

const lexicalState = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        children: [
          {
            type: 'text',
            text: 'Body prose.',
            format: 0,
            style: '',
            mode: 'normal',
            detail: 0,
            version: 1,
          },
        ],
      },
    ],
  },
}

/** The frontmatter a `pnpm docs:check`-clean file carries. */
const frontmatter = {
  title: 'CLI',
  path: 'getting-started-cli',
  summary: 'Add Byline to an existing TanStack Start application.',
}

const storedFile: StoredFileValue = {
  fileId: '2203f8e8-ca6a-458a-b8e3-1aa3573bd55e',
  filename: 'diagram-abc123.png',
  originalFilename: 'diagram.png',
  mimeType: 'image/png',
  fileSize: 4786,
  storageProvider: 'local',
  storagePath: 'media/diagram-abc123.png',
  processingStatus: 'complete',
}

describe('imported docs payloads satisfy the docs collection', () => {
  test('a payload built from docs-check-clean frontmatter validates', () => {
    const issues = validateDocumentFields(
      Docs.fields,
      buildDocPayload({ frontmatter, lexicalState, featureImage: null }),
      { locale: 'en' }
    )
    expect(issues).toEqual([])
  })

  test('the publication date the builder supplies is what satisfies the schema', () => {
    // Regression: `publishedOn` is required by the collection and absent from
    // the documentation frontmatter contract. Dropping the default returns the
    // importer to refusing every file.
    const payload = buildDocPayload({ frontmatter, lexicalState, featureImage: null })
    delete payload.publishedOn
    expect(validateDocumentFields(Docs.fields, payload, { locale: 'en' })).toEqual([
      { field: 'publishedOn', message: 'Published On is required', kind: 'required' },
    ])
  })

  test('a file with no summary is refused, naming the field', () => {
    // `summary` is optional in the frontmatter contract but required by the
    // collection. `pnpm docs:check` rejects a summary-less file first
    // (lib/docs-check.ts, 'missing-summary'), so this is the second gate
    // rather than the only one — it is pinned here so the asymmetry between
    // the two contracts stays visible.
    const { summary, ...withoutSummary } = frontmatter
    const issues = validateDocumentFields(
      Docs.fields,
      buildDocPayload({ frontmatter: withoutSummary, lexicalState, featureImage: null }),
      { locale: 'en' }
    )
    expect(issues).toEqual([{ field: 'summary', message: 'Summary is required', kind: 'required' }])
  })
})

describe('ingested media payloads satisfy the media collection', () => {
  test('an image carrying markdown alt text validates', () => {
    const issues = validateDocumentFields(
      Media.fields,
      buildMediaFields({
        originalFilename: 'diagram.png',
        alt: 'An architecture diagram.',
        storedFile,
      }),
      { locale: 'en' }
    )
    expect(issues).toEqual([])
  })

  test('an image with no markdown alt text still validates', () => {
    const issues = validateDocumentFields(
      Media.fields,
      buildMediaFields({ originalFilename: 'diagram.png', alt: '', storedFile }),
      { locale: 'en' }
    )
    expect(issues).toEqual([])
  })

  test('omitting altText is what the collection refuses', () => {
    // Regression: the shape written before this fix. It reached the write gate
    // only on a first ingest, so a clean import proved nothing about it.
    const fields = buildMediaFields({
      originalFilename: 'diagram.png',
      alt: 'A diagram.',
      storedFile,
    })
    delete fields.altText
    expect(validateDocumentFields(Media.fields, fields, { locale: 'en' })).toEqual([
      { field: 'altText', message: 'Alt Text is required', kind: 'required' },
    ])
  })
})
