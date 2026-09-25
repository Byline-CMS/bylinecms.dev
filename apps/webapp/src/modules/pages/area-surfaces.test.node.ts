import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultContentLocale } from '~/public'

import { getPagePath } from './details.server'
import { pageMarkdownResponse } from './markdown'

const mocks = vi.hoisted(() => ({
  publicFind: vi.fn(),
  viewerFind: vi.fn(),
  preview: vi.fn(),
  serialize: vi.fn(() => 'serialized markdown'),
  cache: vi.fn(({ fn }: { fn: () => unknown }) => fn()),
}))
vi.mock('@byline/client/server', () => ({
  getPublicBylineClient: () => ({ collection: () => ({ findByPath: mocks.publicFind }) }),
  getViewerBylineClient: () => ({ collection: () => ({ findByPath: mocks.viewerFind }) }),
  isPreviewActive: mocks.preview,
}))
vi.mock('@byline/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  documentToMarkdown: mocks.serialize,
  getCollectionDefinition: () => ({ path: 'pages' }),
  getServerConfig: () => ({}),
}))
vi.mock('@/lib/cache/with-cache', () => ({
  withCache: mocks.cache,
  cacheKeys: { details: () => 'details' },
  tags: { details: () => 'details-tag', collection: () => 'collection-tag' },
}))
vi.mock('@/config', () => ({ getPublicConfig: () => ({ serverUrl: 'https://example.com' }) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.preview.mockResolvedValue(false)
})
const doc = { path: 'example', sourceLocale: 'en', fields: { area: 'about' } }

describe('page Markdown area enforcement', () => {
  it('301s the wrong area, preserving locale and query without serializing a duplicate', async () => {
    mocks.publicFind.mockResolvedValue(doc)
    const response = await pageMarkdownResponse('es', 'example', 'root', '?ref=test')
    expect(response.status).toBe(301)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Location')).toBe('/es/about/example.md?ref=test')
    expect(mocks.publicFind).toHaveBeenCalledWith('example', {
      select: ['area'],
      locale: 'es',
      status: 'published',
    })
    expect(mocks.serialize).not.toHaveBeenCalled()
    expect(mocks.viewerFind).not.toHaveBeenCalled()
  })
  it('serves the right shape with area and editorial locale in frontmatter canonical', async () => {
    mocks.publicFind.mockResolvedValue(doc)
    const response = await pageMarkdownResponse('es', 'example', 'about')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('serialized markdown')
    expect(mocks.serialize).toHaveBeenCalledWith(
      doc,
      expect.anything(),
      expect.objectContaining({
        locale: 'es',
        canonicalUrl: 'https://example.com/about/example',
      })
    )
  })
  it('does not redirect missing or unpublished documents', async () => {
    mocks.publicFind.mockResolvedValue(null)
    expect((await pageMarkdownResponse('es', 'example', 'legal')).status).toBe(404)
    expect(mocks.serialize).not.toHaveBeenCalled()
  })
  it('rejects invalid locales before querying', async () => {
    expect((await pageMarkdownResponse('invalid-locale', 'example', 'root')).status).toBe(404)
    expect(mocks.publicFind).not.toHaveBeenCalled()
  })
})

describe('area-derived navigation', () => {
  it('reads only area and uses the page detail invalidation tags', async () => {
    mocks.viewerFind.mockResolvedValue(doc)
    expect(await getPagePath('example')).toBe('/about/example')
    expect(mocks.viewerFind).toHaveBeenCalledWith('example', {
      select: ['area'],
      locale: defaultContentLocale,
      status: 'published',
      localeVisibility: 'public',
    })
    expect(mocks.cache).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'details::path',
        tags: ['collection-tag', 'details-tag'],
        preview: false,
      })
    )
  })
  it('uses preview read and cache bypass for editors reviewing an area change', async () => {
    mocks.preview.mockResolvedValue(true)
    mocks.viewerFind.mockResolvedValue({ ...doc, fields: { area: 'legal' } })
    expect(await getPagePath('example')).toBe('/legal/example')
    expect(mocks.cache).toHaveBeenCalledWith(expect.objectContaining({ preview: true }))
    expect(mocks.viewerFind).toHaveBeenCalledWith(
      'example',
      expect.objectContaining({ status: 'any' })
    )
  })
  it('omits the navigation link when no visible document exists', async () => {
    mocks.viewerFind.mockResolvedValue(null)
    expect(await getPagePath('example')).toBeNull()
  })
})
