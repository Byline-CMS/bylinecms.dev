/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { AdminAuth, createRequestContext, createSuperAdminContext } from '@byline/auth'
import type {
  CollectionDefinition,
  SearchCapabilities,
  SearchProvider,
  SearchRangeFacetRequest,
  SearchResults,
} from '@byline/core'
import { MAX_RANGE_FACET_BUCKETS } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { type CollectionSearchOptions, createBylineClient } from '../../src/index.js'
import { testAdapter } from '../fixtures/test-adapter.js'

const publications: CollectionDefinition = {
  path: 'publications',
  labels: { singular: 'Publication', plural: 'Publications' },
  search: {
    body: ['title'],
    filters: ['publicationDate', 'rating', 'title'],
    zones: ['library'],
  },
  fields: [
    { name: 'title', type: 'text', label: 'Title' },
    { name: 'publicationDate', type: 'integer', label: 'Publication date' },
    { name: 'rating', type: 'float', label: 'Rating' },
    { name: 'unindexed', type: 'integer', label: 'Unindexed integer' },
  ],
}
const request: SearchRangeFacetRequest = { field: 'publicationDate', start: 0, end: 25, gap: 10 }
const buckets = [
  { start: 0, end: 10, count: 3 },
  { start: 10, end: 20, count: 0 },
  { start: 20, end: 25, count: 2 },
]
const aggregates: SearchResults = {
  hits: [],
  total: 5,
  facets: { topics: [{ value: 'forest', count: 5 }] },
  rangeFacets: { publicationDate: buckets },
}

function fixture(
  collections: CollectionDefinition[] = [publications],
  capabilities: Partial<SearchCapabilities> = { rangeFacets: true },
  results: SearchResults = aggregates,
  requestContext = createSuperAdminContext()
) {
  const search = vi.fn<SearchProvider['search']>().mockResolvedValue(results)
  const provider: SearchProvider = {
    capabilities: {
      facets: true,
      typoTolerance: false,
      semantic: false,
      bm25: false,
      weighting: false,
      highlights: false,
      fullText: {
        nativeAnalysis: true,
        portableAnalysis: false,
        allTerms: true,
        anyTerms: false,
        minimumShouldMatch: false,
        phrase: false,
      },
      ...capabilities,
    },
    search,
    upsert: vi.fn(),
    remove: vi.fn(),
    reindex: vi.fn(),
  }
  const client = createBylineClient({
    db: testAdapter(),
    collections,
    requestContext,
    search: provider,
  })
  return { client, search }
}

const entryPoints = ['collection', 'zone'] as const

describe.each(entryPoints)('%s range facets', (entryPoint) => {
  const run = (client: ReturnType<typeof fixture>['client'], options: CollectionSearchOptions) =>
    entryPoint === 'collection'
      ? client.collection('publications').search(options)
      : client.search({ ...options, zone: 'library' })

  it('forwards range facets and preserves truncated, zero-count buckets and term facets', async () => {
    const { client, search } = fixture()
    const options: CollectionSearchOptions = {
      query: 'forest',
      rangeFacets: [request],
      where: { publicationDate: { $gte: 10 } },
      facets: ['topics'],
      locale: 'th',
      status: 'published',
      limit: 0,
      offset: 0,
    }
    expect(await run(client, options)).toEqual(aggregates)
    expect(search).toHaveBeenCalledWith({
      ...options,
      fieldScope: undefined,
      matching: undefined,
      ...(entryPoint === 'collection' ? { collectionPath: 'publications' } : { zone: 'library' }),
    })
    // structuredFilters is absent: where remains an advertise-only contract.
    expect(search.mock.calls[0]?.[0].where).toBe(options.where)
  })

  it.each([undefined, false])('rejects capability %s before calling the provider', async (flag) => {
    const { client, search } = fixture([publications], { rangeFacets: flag })
    await expect(run(client, { query: '', rangeFacets: [request] })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
      message: 'The registered search provider does not support range facets.',
    })
    expect(search).not.toHaveBeenCalled()
  })

  const invalidRequests: Array<[string, SearchRangeFacetRequest[]]> = [
    ['non-finite start', [{ ...request, start: Number.NaN }]],
    ['non-finite end', [{ ...request, end: Number.POSITIVE_INFINITY }]],
    ['non-finite gap', [{ ...request, gap: Number.NEGATIVE_INFINITY }]],
    ['zero gap', [{ ...request, gap: 0 }]],
    ['negative gap', [{ ...request, gap: -1 }]],
    ['equal edges', [{ ...request, end: 0 }]],
    ['reversed edges', [{ ...request, end: -1 }]],
    ['over cap', [{ ...request, end: MAX_RANGE_FACET_BUCKETS * 10 + 1 }]],
    ['overflowing span', [{ ...request, start: -Number.MAX_VALUE, end: Number.MAX_VALUE }]],
    ['duplicate field', [request, request]],
    ['unknown field', [{ ...request, field: 'missing' }]],
    ['undeclared integer', [{ ...request, field: 'unindexed' }]],
    ['float filter', [{ ...request, field: 'rating' }]],
    ['text filter', [{ ...request, field: 'title' }]],
    ['empty field', [{ ...request, field: '' }]],
  ]
  it.each(invalidRequests)('rejects %s before calling the provider', async (_name, rangeFacets) => {
    const { client, search } = fixture()
    await expect(run(client, { query: '', rangeFacets })).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
    expect(search).not.toHaveBeenCalled()
  })

  it('accepts exactly the bucket cap', async () => {
    const { client, search } = fixture()
    await run(client, {
      query: '',
      rangeFacets: [{ ...request, end: MAX_RANGE_FACET_BUCKETS * 10 }],
    })
    expect(search).toHaveBeenCalledOnce()
  })

  it('accepts fractional interval edges and gap over an integer filter', async () => {
    const rangeFacets = [{ ...request, start: 0.5, end: 2.5, gap: 0.75 }]
    // Integer values 1 and 2 fall in the first and last buckets respectively.
    const results: SearchResults = {
      hits: [],
      total: 2,
      rangeFacets: {
        publicationDate: [
          { start: 0.5, end: 1.25, count: 1 },
          { start: 1.25, end: 2, count: 0 },
          { start: 2, end: 2.5, count: 1 },
        ],
      },
    }
    const { client, search } = fixture([publications], { rangeFacets: true }, results)
    expect(await run(client, { query: '', rangeFacets })).toEqual(results)
    expect(search.mock.calls[0]?.[0].rangeFacets).toBe(rangeFacets)
  })

  it.each([
    { name: 'non-array option', value: {} },
    { name: 'null entry', value: [null] },
    { name: 'missing field', value: [{ start: 0, end: 10, gap: 1 }] },
    { name: 'numeric string', value: [{ ...request, start: '0' }] },
  ])('rejects malformed runtime input: $name', async ({ value }) => {
    const { client, search } = fixture()
    await expect(
      run(client, { query: '', rangeFacets: value as SearchRangeFacetRequest[] })
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(search).not.toHaveBeenCalled()
  })

  it.each([{ rangeFacets: undefined }, { rangeFacets: [] }])(
    'preserves existing searches with %j',
    async ({ rangeFacets }) => {
      const result = { hits: [], total: 0, facets: undefined }
      const { client, search } = fixture([publications], {}, result)
      const where = { title: { $eq: 'forest' } }
      expect(await run(client, { query: 'forest', where, rangeFacets })).toStrictEqual(result)
      expect(search.mock.calls[0]?.[0].where).toBe(where)
      expect(search.mock.calls[0]?.[0].rangeFacets).toBeUndefined()
    }
  )

  it('omits both aggregates and replaces totals under beforeRead row scoping', async () => {
    const beforeRead = vi.fn(() => ({ title: 'visible' }))
    const { client, search } = fixture([{ ...publications, hooks: { beforeRead } }])
    expect(await run(client, { query: '', rangeFacets: [request] })).toStrictEqual({
      hits: [],
      total: 0,
    })
    expect(beforeRead).toHaveBeenCalledOnce()
    expect(search).toHaveBeenCalledOnce()
  })
})

describe('zone range-facet membership', () => {
  it.each(['missing filter', 'float filter', 'text filter'])(
    'rejects a member with %s',
    async (kind) => {
      const other: CollectionDefinition = {
        ...publications,
        path: 'other',
        search: {
          ...publications.search,
          filters: kind === 'missing filter' ? [] : ['publicationDate'],
        },
        fields: [
          {
            name: 'publicationDate',
            label: 'Date',
            type: kind === 'float filter' ? 'float' : 'text',
          },
        ],
      }
      const { client, search } = fixture([publications, other])
      await expect(
        client.search({ zone: 'library', query: '', rangeFacets: [request] })
      ).rejects.toMatchObject({
        code: 'ERR_VALIDATION',
        message:
          "Search range facet 'publicationDate' must name an integer field declared in search.filters for collection 'other'.",
      })
      expect(search).not.toHaveBeenCalled()
    }
  )

  it('accepts a shared integer filter in every member', async () => {
    const { client } = fixture([publications, { ...publications, path: 'other' }])
    expect(await client.search({ zone: 'library', query: '', rangeFacets: [request] })).toEqual(
      aggregates
    )
  })

  it('omits aggregates when a zone member is unreadable', async () => {
    const context = createRequestContext({
      actor: new AdminAuth({ id: 'reader', abilities: ['collections.publications.read'] }),
    })
    const { client } = fixture(
      [publications, { ...publications, path: 'other' }],
      { rangeFacets: true },
      aggregates,
      context
    )
    expect(
      await client.search({ zone: 'library', query: '', rangeFacets: [request] })
    ).toStrictEqual({ hits: [], total: 0 })
  })

  it('validates unreadable members too because the provider still searches the whole zone', async () => {
    const context = createRequestContext({
      actor: new AdminAuth({ id: 'reader', abilities: ['collections.publications.read'] }),
    })
    const { client, search } = fixture(
      [publications, { ...publications, path: 'other', search: { zones: ['library'] } }],
      { rangeFacets: true },
      aggregates,
      context
    )
    await expect(
      client.search({ zone: 'library', query: '', rangeFacets: [request] })
    ).rejects.toMatchObject({ code: 'ERR_VALIDATION' })
    expect(search).not.toHaveBeenCalled()
  })
})
