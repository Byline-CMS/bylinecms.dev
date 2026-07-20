/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Contract tests for the document-grain markdown assembler. The expected
 * strings ARE the format contract — agents build on this shape, so a
 * change here is a consumer-visible format change and should be
 * deliberate (docs/05-reading-and-delivery/04-markdown-export.md →
 * "The output is a contract surface").
 */

import { describe, expect, it } from 'vitest'

import { documentToMarkdown } from './document-to-markdown.js'
import type { CollectionDefinition } from '../@types/index.js'

const definition: CollectionDefinition = {
  path: 'docs',
  labels: { singular: 'Doc', plural: 'Docs' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    { name: 'summary', label: 'Summary', type: 'textArea', localized: true },
    { name: 'subtitle', label: 'Subtitle', type: 'text' },
    { name: 'publishedOn', label: 'Published On', type: 'datetime' },
    { name: 'featured', label: 'Featured', type: 'checkbox', optional: true },
    {
      name: 'featureImage',
      label: 'Feature Image',
      type: 'relation',
      targetCollection: 'media',
      displayField: 'title',
      optional: true,
    },
    {
      name: 'meta',
      label: 'Meta',
      type: 'group',
      fields: [{ name: 'keywords', label: 'Keywords', type: 'text', optional: true }],
    },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      optional: true,
      blocks: [
        {
          blockType: 'richTextBlock',
          labels: { singular: 'Rich Text', plural: 'Rich Texts' },
          fields: [{ name: 'richText', label: 'Rich Text', type: 'richText', localized: true }],
        },
      ],
    },
  ],
} as CollectionDefinition

const baseDoc = {
  path: 'getting-started',
  updatedAt: new Date('2026-06-01T12:00:00Z'),
  fields: {
    title: 'Getting Started',
    summary: 'How to begin.',
    publishedOn: new Date('2026-05-01T00:00:00Z'),
  },
}

describe('documentToMarkdown', () => {
  it('renders frontmatter, H1, and the summary standfirst', () => {
    const markdown = documentToMarkdown(baseDoc, definition, {
      locale: 'en',
      canonicalUrl: 'https://example.com/docs/getting-started',
    })
    expect(markdown).toBe(
      [
        '---',
        'title: "Getting Started"',
        'description: "How to begin."',
        'canonical: "https://example.com/docs/getting-started"',
        'locale: "en"',
        'collection: "docs"',
        'published: "2026-05-01T00:00:00.000Z"',
        'updated: "2026-06-01T12:00:00.000Z"',
        '---',
        '',
        '# Getting Started',
        '',
        'How to begin.',
        '',
      ].join('\n')
    )
  })

  it('renders scalar fields as labelled lines and skips empty values', () => {
    const markdown = documentToMarkdown(
      {
        ...baseDoc,
        fields: { ...baseDoc.fields, subtitle: 'A subtitle', featured: true },
      },
      definition,
      {}
    )
    expect(markdown).toContain('**Subtitle:** A subtitle')
    // Booleans render nothing — presentation toggles are not content.
    expect(markdown).not.toContain('Featured')
    expect(markdown).not.toContain('Keywords') // empty group skipped, no heading
  })

  it('renders blocks content directly via the richtext seam — no heading', () => {
    const markdown = documentToMarkdown(
      {
        ...baseDoc,
        fields: {
          ...baseDoc.fields,
          content: [
            { _type: 'richTextBlock', richText: { root: { children: [] } } },
            { _type: 'richTextBlock', richText: { root: { children: [] } } },
          ],
        },
      },
      definition,
      {
        richTextToMarkdown: ({ fieldPath }) => `serialized(${fieldPath})`,
      }
    )
    expect(markdown).toContain('serialized(richText)\n\nserialized(richText)')
    expect(markdown).not.toContain('## Content')
  })

  it('skips richtext entirely when no serializer is registered', () => {
    const markdown = documentToMarkdown(
      {
        ...baseDoc,
        fields: {
          ...baseDoc.fields,
          content: [{ _type: 'richTextBlock', richText: { root: { children: [] } } }],
        },
      },
      definition,
      {}
    )
    expect(markdown).not.toContain('serialized')
    expect(markdown).not.toContain('[object')
  })

  it('renders populated relations as links via resolveUrl', () => {
    const markdown = documentToMarkdown(
      {
        ...baseDoc,
        fields: {
          ...baseDoc.fields,
          featureImage: {
            targetDocumentId: 'm-1',
            _resolved: true,
            document: { path: 'hero-shot', fields: { title: 'Hero Shot' } },
          },
        },
      },
      definition,
      { resolveUrl: (collection, path) => `/${collection}/${path}` }
    )
    expect(markdown).toContain('**Feature Image:** [Hero Shot](/media/hero-shot)')
  })

  it('renders unresolved relations as nothing', () => {
    const markdown = documentToMarkdown(
      {
        ...baseDoc,
        fields: {
          ...baseDoc.fields,
          featureImage: { targetDocumentId: 'gone', _resolved: false },
        },
      },
      definition,
      {}
    )
    expect(markdown).not.toContain('Feature Image')
  })

  it('renders group fields as sections', () => {
    const markdown = documentToMarkdown(
      { ...baseDoc, fields: { ...baseDoc.fields, meta: { keywords: 'cms, markdown' } } },
      definition,
      {}
    )
    expect(markdown).toContain('## Meta\n\n**Keywords:** cms, markdown')
  })

  it('unwraps locale envelopes that reach the export untrimmed', () => {
    const markdown = documentToMarkdown(
      { ...baseDoc, fields: { ...baseDoc.fields, title: { en: 'English', fr: 'Français' } } },
      definition,
      { locale: 'fr' }
    )
    expect(markdown).toContain('# Français')
    expect(markdown).not.toContain('[object')
  })

  it('escapes double quotes in frontmatter strings', () => {
    const markdown = documentToMarkdown(
      { ...baseDoc, fields: { ...baseDoc.fields, title: 'The "Big" One' } },
      definition,
      {}
    )
    expect(markdown).toContain('title: "The \\"Big\\" One"')
  })
})
