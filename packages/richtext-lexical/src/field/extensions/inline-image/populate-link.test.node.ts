/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tests for `inlineImageLinkVisitor` — the second relation on an
 * inline-image node. The flat relation envelope on the node addresses the
 * *media* document; `node.link` optionally addresses a *click-through
 * target*, which is an entirely different document in an entirely
 * different collection.
 *
 * The two relations hydrate independently through the same
 * `runLexicalPopulate` pass, because the driver runs every visitor against
 * every node and enqueues each match separately. The final suite here
 * pins that co-existence — it is the whole reason a second visitor is the
 * right shape rather than widening `inlineImageVisitor`.
 */

import {
  type BylineLogger,
  type CollectionDefinition,
  createReadContext,
  defineServerConfig,
  type StoredFileValue,
} from '@byline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type LexicalNodeLike, runLexicalPopulate } from '../../lexical-populate-shared'
import { inlineImageLinkVisitor, inlineImageVisitor } from './populate'

// ---------------------------------------------------------------------------
// Test harness — mirrors `extensions/link/populate.test.node.ts`
// ---------------------------------------------------------------------------

function makeLogger(): BylineLogger {
  return {
    log: vi.fn(),
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  }
}

function registerCollection(definition: Partial<CollectionDefinition> & { path: string }): void {
  defineServerConfig({
    collections: [
      {
        labels: { singular: 'Page', plural: 'Pages' },
        fields: [{ name: 'title', type: 'text', label: 'Title' }],
        useAsTitle: 'title',
        ...definition,
      } as CollectionDefinition,
    ],
  } as unknown as Parameters<typeof defineServerConfig>[0])
}

function clearConfig(): void {
  ;(globalThis as any)[Symbol.for('__byline_server_config__')] = null
  ;(globalThis as any)[Symbol.for('__byline_client_config__')] = null
}

function installLogger(logger: BylineLogger): void {
  ;(globalThis as any)[Symbol.for('__byline_logger__')] = logger
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface InlineImageNodeLike extends LexicalNodeLike {
  src?: string
  position?: string
  link?: Record<string, any>
}

/**
 * An inline-image node carrying BOTH relations: the flat envelope points
 * at `media/media-1`, `link` points at `pages/doc-1`.
 */
function makeLinkedImageNode(link?: Record<string, any>): InlineImageNodeLike {
  return {
    type: 'inline-image',
    src: 'https://cdn.example.com/media/stale-card.avif',
    position: 'left',
    targetCollectionPath: 'media',
    targetDocumentId: 'media-1',
    document: { title: 'Stale media title' },
    link,
  }
}

const internalLink = {
  linkType: 'internal',
  newTab: false,
  targetDocumentId: 'doc-1',
  targetCollectionId: 'coll-1',
  targetCollectionPath: 'pages',
  document: { title: 'Stale link title', path: '/pages/stale' },
}

const linkTarget = {
  id: 'doc-1',
  path: 'about',
  status: 'published',
  fields: { title: 'About Us' },
}

const mediaImage = {
  fileId: 'file-1',
  filename: 'current.jpg',
  originalFilename: 'current.jpg',
  mimeType: 'image/jpeg',
  fileSize: 123,
  storageProvider: 's3',
  storagePath: 'media/current.jpg',
  storageUrl: 'https://cdn.example.com/media/current.jpg',
  imageWidth: 4000,
  imageHeight: 3000,
  processingStatus: 'complete',
  variants: [
    {
      name: 'card',
      storagePath: 'media/current-card.avif',
      storageUrl: 'https://cdn.example.com/media/current-card.avif',
      width: 600,
      height: 450,
      format: 'avif',
    },
  ],
} satisfies StoredFileValue

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('inlineImageLinkVisitor', () => {
  beforeEach(() => {
    installLogger(makeLogger())
    clearConfig()
  })

  afterEach(() => {
    clearConfig()
  })

  describe('match', () => {
    it('returns null for nodes that are not inline images', () => {
      expect(inlineImageLinkVisitor.match({ type: 'paragraph' })).toBeNull()
    })

    it('returns null for an inline image with no link', () => {
      expect(inlineImageLinkVisitor.match(makeLinkedImageNode(undefined))).toBeNull()
    })

    it('returns null for a custom-URL link, which carries no relation', () => {
      const node = makeLinkedImageNode({
        linkType: 'custom',
        url: 'https://example.com',
        newTab: true,
      })
      expect(inlineImageLinkVisitor.match(node)).toBeNull()
    })

    it('returns null when the link relation is missing its document id', () => {
      const node = makeLinkedImageNode({ linkType: 'internal', targetCollectionPath: 'pages' })
      expect(inlineImageLinkVisitor.match(node)).toBeNull()
    })

    // The load-bearing assertion: the pending hydration addresses the LINK
    // target, not the media document the flat envelope points at.
    it('addresses the link target rather than the media document', () => {
      registerCollection({ path: 'pages' })
      const pending = inlineImageLinkVisitor.match(makeLinkedImageNode({ ...internalLink }))

      expect(pending?.collectionPath).toBe('pages')
      expect(pending?.documentId).toBe('doc-1')
    })
  })

  describe('apply', () => {
    it('refreshes the link title and path from the resolved target', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })

      inlineImageLinkVisitor.match(node)?.apply(linkTarget)

      expect(node.link?.document).toEqual({ title: 'About Us', path: '/pages/about' })
    })

    it('uses buildDocumentPath when the collection defines one', () => {
      registerCollection({
        path: 'pages',
        useAsTitle: 'title',
        buildDocumentPath: (doc) => `/custom/${doc.path}`,
      })
      const node = makeLinkedImageNode({ ...internalLink })

      inlineImageLinkVisitor.match(node)?.apply(linkTarget)

      expect(node.link?.document?.path).toBe('/custom/about')
    })

    it('leaves the media relation completely untouched', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })

      inlineImageLinkVisitor.match(node)?.apply(linkTarget)

      expect(node.targetCollectionPath).toBe('media')
      expect(node.targetDocumentId).toBe('media-1')
      expect(node.document).toEqual({ title: 'Stale media title' })
    })

    it('clears a stale _resolved flag once the target resolves again', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({
        ...internalLink,
        document: { _resolved: false },
      })

      inlineImageLinkVisitor.match(node)?.apply(linkTarget)

      expect(node.link?.document).not.toHaveProperty('_resolved')
    })
  })

  describe('applyMissing', () => {
    it('marks the link unresolved and drops the stale title and path', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })

      inlineImageLinkVisitor.match(node)?.applyMissing?.()

      expect(node.link?.document).toEqual({ _resolved: false })
    })

    // The image must keep rendering even when its click target is gone —
    // only the anchor is dropped, by the renderer, off `_resolved: false`.
    it('leaves the image itself renderable', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })

      inlineImageLinkVisitor.match(node)?.applyMissing?.()

      expect(node.src).toBe('https://cdn.example.com/media/stale-card.avif')
      expect(node.targetDocumentId).toBe('media-1')
    })
  })

  describe('alongside inlineImageVisitor in one populate pass', () => {
    it('hydrates both relations from their own collections', async () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })

      const readDocuments = vi.fn(async ({ collectionPath }: { collectionPath: string }) =>
        collectionPath === 'media'
          ? [
              {
                document_id: 'media-1',
                path: 'shot',
                status: 'published',
                fields: { image: mediaImage, title: 'Current media title' },
              },
            ]
          : [
              {
                document_id: 'doc-1',
                path: 'about',
                status: 'published',
                fields: { title: 'About Us' },
              },
            ]
      )

      await runLexicalPopulate({
        readContext: createReadContext(),
        readDocuments,
        visitors: [inlineImageVisitor, inlineImageLinkVisitor],
        values: [{ root: { type: 'root', children: [node] } }],
      })

      // Media relation refreshed from `media`…
      expect(node.src).toBe('https://cdn.example.com/media/current-card.avif')
      expect(node.document).toEqual(
        expect.objectContaining({ title: 'Current media title', image: mediaImage })
      )
      // …and the link relation refreshed from `pages`, in the same pass.
      expect(node.link?.document).toEqual({ title: 'About Us', path: '/pages/about' })
    })

    it('batches one read per collection', async () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeLinkedImageNode({ ...internalLink })
      const readDocuments = vi.fn().mockResolvedValue([])

      await runLexicalPopulate({
        readContext: createReadContext(),
        readDocuments,
        visitors: [inlineImageVisitor, inlineImageLinkVisitor],
        values: [{ root: { type: 'root', children: [node] } }],
      })

      expect(readDocuments).toHaveBeenCalledTimes(2)
      expect(readDocuments.mock.calls.map(([arg]) => arg)).toEqual(
        expect.arrayContaining([
          { collectionPath: 'media', documentIds: ['media-1'] },
          { collectionPath: 'pages', documentIds: ['doc-1'] },
        ])
      )
    })
  })
})

describe('inlineImageLinkVisitor never reuses a stale click-through path', () => {
  beforeEach(() => {
    installLogger(makeLogger())
    clearConfig()
  })

  afterEach(() => {
    clearConfig()
  })

  it('marks the click-through unresolved when the path hook throws, without reactivating it', () => {
    registerCollection({
      path: 'pages',
      buildDocumentPath: () => {
        throw new Error('boom')
      },
    })
    const node = makeLinkedImageNode({
      ...internalLink,
      document: { title: 'Stale', path: '/pages/stale', _resolved: false },
    })

    inlineImageLinkVisitor.match(node)?.apply(linkTarget)

    expect(node.link?.document?.path).toBeUndefined()
    expect(node.link?.document?._resolved).toBe(false)
    expect(node.link?.targetDocumentId, 'identity kept').toBe('doc-1')
  })

  it('marks the click-through unresolved when the target has no usable path', () => {
    registerCollection({ path: 'pages' })
    const node = makeLinkedImageNode({ ...internalLink })

    inlineImageLinkVisitor.match(node)?.apply({ ...linkTarget, path: '' })

    expect(node.link?.document?.path).toBeUndefined()
    expect(node.link?.document?._resolved).toBe(false)
  })

  it('a missing click-through target does not suppress an independently readable image', async () => {
    registerCollection({ path: 'pages' })
    const node = makeLinkedImageNode({ ...internalLink })
    const readDocuments = vi.fn(async ({ collectionPath }: { collectionPath: string }) =>
      collectionPath === 'media'
        ? [
            {
              document_id: 'media-1',
              path: 'm',
              status: 'published',
              fields: { image: mediaImage },
            },
          ]
        : []
    )

    await runLexicalPopulate({
      readContext: createReadContext(),
      readDocuments,
      visitors: [inlineImageVisitor, inlineImageLinkVisitor],
      values: [{ root: { type: 'root', children: [node] } }],
    })

    expect(node.link?.document?._resolved).toBe(false)
    expect(node.link?.document?.path).toBeUndefined()
    expect(node.document?._resolved).toBeUndefined()
    expect(node.document?.image).toEqual(mediaImage)
    expect(node.src).toBe('https://cdn.example.com/media/current-card.avif')
  })
})
