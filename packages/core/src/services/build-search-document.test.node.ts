/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Contract tests for the document-grain search assembler. Verifies the
 * role-based projection (body / facets / filters / zones), the schema-derived
 * type enrichment, per-field boost, and that nothing outside the config is
 * pulled (no leakage of unindexed content).
 */

import { describe, expect, it } from 'vitest'

import { buildSearchDocument } from './build-search-document.js'
import type { CollectionDefinition, SearchField } from '../@types/index.js'

// A controlled-vocabulary facet collection: a `counter` id + a `name` term.
const topics: CollectionDefinition = {
  path: 'topics',
  labels: { singular: 'Topic', plural: 'Topics' },
  useAsTitle: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'text', localized: true },
    { name: 'facetId', label: 'Facet Id', type: 'counter', group: 'publication-facets' },
  ],
}

const publications: CollectionDefinition = {
  path: 'publications',
  labels: { singular: 'Publication', plural: 'Publications' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    { name: 'abstract', label: 'Abstract', type: 'richText', localized: true },
    { name: 'editorialNotes', label: 'Editorial Notes', type: 'textArea' },
    { name: 'publicationDate', label: 'Date', type: 'datetime' },
    { name: 'citationCount', label: 'Citations', type: 'integer' },
    {
      name: 'topics',
      label: 'Topics',
      type: 'relation',
      targetCollection: 'topics',
    },
  ],
  search: {
    body: ['title', { field: 'abstract', boost: 2 }],
    facets: ['topics'],
    filters: ['publicationDate', 'citationCount'],
    zones: ['site', 'publications'],
  },
}

const resolveTargetDefinition = (path: string) => (path === 'topics' ? topics : null)

// Stub `toText` seam — returns a string property so we don't depend on Lexical.
const richTextToText = ({ value }: { value: unknown }) =>
  typeof value === 'object' && value != null ? String((value as any).text ?? '') : ''

function source() {
  return {
    documentId: 'doc-1',
    locale: 'en',
    status: 'published',
    path: 'forest-restoration',
    updatedAt: '2026-06-01T00:00:00.000Z',
    fields: {
      title: 'Forest Restoration',
      abstract: { text: 'Methods for restoring degraded forest.' },
      editorialNotes: 'Internal: chase the author for figures.',
      publicationDate: '2026-05-01T00:00:00.000Z',
      citationCount: 42,
      topics: [
        {
          _resolved: true,
          document: { documentId: 't-1', fields: { name: 'Ecology', facetId: 1 } },
        },
        {
          _resolved: true,
          document: { documentId: 't-2', fields: { name: 'Biodiversity', facetId: 2 } },
        },
      ],
    },
  }
}

function fieldByName(fields: SearchField[], name: string) {
  return fields.find((f) => f.name === name)
}

describe('buildSearchDocument', () => {
  const doc = buildSearchDocument(source(), publications, {
    richTextToText,
    resolveTargetDefinition,
  })

  it('sets identity, status, locale, path, and updatedAt', () => {
    expect(doc.collectionPath).toBe('publications')
    expect(doc.documentId).toBe('doc-1')
    expect(doc.locale).toBe('en')
    expect(doc.status).toBe('published')
    expect(doc.title).toBe('Forest Restoration')
    expect(doc.path).toBe('forest-restoration')
    expect(doc.updatedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('resolves zones from config', () => {
    expect(doc.zones).toEqual(['site', 'publications'])
  })

  it('projects body text fields as type:text role:body', () => {
    const title = fieldByName(doc.fields, 'title')
    expect(title).toMatchObject({
      name: 'title',
      type: 'text',
      role: 'body',
      value: 'Forest Restoration',
    })
  })

  it('extracts richText body via the toText seam and carries boost', () => {
    const abstract = fieldByName(doc.fields, 'abstract')
    expect(abstract).toMatchObject({
      name: 'abstract',
      type: 'text',
      role: 'body',
      value: 'Methods for restoring degraded forest.',
      boost: 2,
    })
  })

  it('resolves facets to {id, term} from target counter + useAsTitle', () => {
    const topicsField = fieldByName(doc.fields, 'topics')
    expect(topicsField).toMatchObject({ name: 'topics', type: 'facet', role: 'facet' })
    expect(topicsField?.value).toEqual([
      { id: 1, term: 'Ecology' },
      { id: 2, term: 'Biodiversity' },
    ])
  })

  it('projects filters with schema-derived types', () => {
    expect(fieldByName(doc.fields, 'publicationDate')).toMatchObject({
      type: 'datetime',
      role: 'filter',
      value: '2026-05-01T00:00:00.000Z',
    })
    expect(fieldByName(doc.fields, 'citationCount')).toMatchObject({
      type: 'integer',
      role: 'filter',
      value: 42,
    })
  })

  it('does not pull fields outside the search config (no leakage)', () => {
    expect(fieldByName(doc.fields, 'editorialNotes')).toBeUndefined()
  })

  it('defaults zones to the collection path when unset', () => {
    const noZones: CollectionDefinition = { ...publications, search: { body: ['title'] } }
    const out = buildSearchDocument(source(), noZones)
    expect(out.zones).toEqual(['publications'])
  })

  it('skips richText body fields when no toText seam is registered', () => {
    const out = buildSearchDocument(source(), publications, { resolveTargetDefinition })
    expect(fieldByName(out.fields, 'abstract')).toBeUndefined()
    // Plain text body field still projects.
    expect(fieldByName(out.fields, 'title')).toBeDefined()
  })

  it('resolves localized values to the requested locale', () => {
    const localized = {
      ...source(),
      fields: { ...source().fields, title: { en: 'Forest Restoration', fr: 'Restauration' } },
    }
    const out = buildSearchDocument(localized, publications, {
      richTextToText,
      resolveTargetDefinition,
      locale: 'fr',
    })
    expect(out.title).toBe('Restauration')
  })
})

// A collection whose prose lives inside a `blocks` field (the docs shape):
// RichTextBlock (richText + a checkbox toggle) and PhotoBlock (text alt +
// richText caption + a select + a relation). Mirrors the real-world case where
// the searchable body is nested, not top-level.
const blocksCollection: CollectionDefinition = {
  path: 'articles',
  labels: { singular: 'Article', plural: 'Articles' },
  useAsTitle: 'title',
  fields: [
    { name: 'title', label: 'Title', type: 'text', localized: true },
    {
      name: 'content',
      label: 'Content',
      type: 'blocks',
      blocks: [
        {
          blockType: 'richTextBlock',
          label: 'Richtext Block',
          fields: [
            { name: 'richText', label: 'Richtext', type: 'richText', localized: true },
            { name: 'constrainedWidth', label: 'Constrained', type: 'checkbox' },
          ],
        },
        {
          blockType: 'photoBlock',
          label: 'Photo Block',
          fields: [
            {
              name: 'display',
              label: 'Display',
              type: 'select',
              options: [
                { label: 'Default', value: 'default' },
                { label: 'Wide', value: 'wide' },
              ],
            },
            { name: 'photo', label: 'Photo', type: 'relation', targetCollection: 'media' },
            { name: 'alt', label: 'Alt', type: 'text' },
            { name: 'caption', label: 'Caption', type: 'richText', localized: true },
          ],
        },
      ],
    },
  ],
  search: { body: [{ field: 'title', boost: 2 }, 'content'] },
}

describe('buildSearchDocument — container (blocks) body', () => {
  function blockSource() {
    return {
      documentId: 'art-1',
      locale: 'en',
      status: 'published',
      path: 'forests',
      fields: {
        title: 'Forests',
        content: [
          {
            _type: 'richTextBlock',
            _id: 'b1',
            richText: { text: 'None of this is certain. But it reflects what we observed.' },
            constrainedWidth: true,
          },
          {
            _type: 'photoBlock',
            _id: 'b2',
            display: 'wide',
            photo: { _resolved: true, document: { fields: { title: 'A tree' } } },
            alt: 'A tall redwood',
            caption: { text: 'Old growth in the valley.' },
          },
        ],
      },
    }
  }

  const doc = buildSearchDocument(blockSource(), blocksCollection, { richTextToText })

  it('walks the blocks field and flattens nested richText + text leaves', () => {
    const content = fieldByName(doc.fields, 'content')
    expect(content).toMatchObject({ name: 'content', type: 'text', role: 'body' })
    const value = content?.value as string
    expect(value).toContain('it reflects what we observed')
    expect(value).toContain('A tall redwood')
    expect(value).toContain('Old growth in the valley.')
  })

  it('skips nested non-text leaves (select, relation, checkbox) — no config noise', () => {
    const value = fieldByName(doc.fields, 'content')?.value as string
    expect(value).not.toContain('wide') // select
    expect(value).not.toContain('A tree') // relation target title
    expect(value).not.toContain('true') // checkbox
  })

  it('preserves top-level scalar body fields alongside the container', () => {
    expect(fieldByName(doc.fields, 'title')).toMatchObject({ value: 'Forests', boost: 2 })
  })

  it('omits the container body field entirely when no toText seam is registered', () => {
    // With no richText extractor, the only text-bearing leaves left are the
    // PhotoBlock `alt` text.
    const out = buildSearchDocument(blockSource(), blocksCollection)
    const value = fieldByName(out.fields, 'content')?.value as string
    expect(value).toBe('A tall redwood')
  })

  it('produces no content field when a block field set has no text', () => {
    const empty = {
      ...blockSource(),
      fields: {
        title: 'Forests',
        content: [{ _type: 'photoBlock', _id: 'b3', display: 'wide' }],
      },
    }
    const out = buildSearchDocument(empty, blocksCollection, { richTextToText })
    expect(fieldByName(out.fields, 'content')).toBeUndefined()
  })
})
