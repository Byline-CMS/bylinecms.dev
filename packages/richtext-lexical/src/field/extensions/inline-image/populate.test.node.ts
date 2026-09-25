/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createReadContext, type StoredFileValue } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { type LexicalNodeLike, runLexicalPopulate } from '../../lexical-populate-shared'
import { lexicalToMarkdown } from '../../markdown/lexical-to-markdown'
import { inlineImageVisitor } from './populate'
import type { Position } from './node-types'

/**
 * A re-keyed media document: every URL below differs from the stale ones
 * the fixture node carries, so any assertion that the node was refreshed
 * is also an assertion that it was refreshed from *this* document.
 * Variant names and dimensions mirror the `media` collection's declared
 * `sizes` (see `apps/webapp/byline/collections/media/schema.ts`).
 */
const currentImage = {
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
      name: 'thumbnail',
      storagePath: 'media/current-thumbnail.avif',
      storageUrl: 'https://cdn.example.com/media/current-thumbnail.avif',
      width: 400,
      height: 400,
      format: 'avif',
    },
    {
      name: 'card',
      storagePath: 'media/current-card.avif',
      storageUrl: 'https://cdn.example.com/media/current-card.avif',
      width: 600,
      height: 450,
      format: 'avif',
    },
    {
      name: 'tablet',
      storagePath: 'media/current-tablet.avif',
      storageUrl: 'https://cdn.example.com/media/current-tablet.avif',
      width: 1024,
      height: 768,
      format: 'avif',
    },
    {
      name: 'desktop',
      storagePath: 'media/current-desktop.avif',
      storageUrl: 'https://cdn.example.com/media/current-desktop.avif',
      width: 1600,
      height: 1200,
      format: 'avif',
    },
  ],
} satisfies StoredFileValue

/** The same upload with no variants generated — the fallback-to-original path. */
const variantlessImage = {
  ...currentImage,
  variants: undefined,
} satisfies StoredFileValue

const STALE_SRC = 'https://cdn.example.com/media/stale-card.avif'
const STALE_WIDTH = 600
const STALE_HEIGHT = 450

interface InlineImageNodeLike extends LexicalNodeLike {
  src?: string
  position?: Position
  width?: number | string
  height?: number | string
}

function makeNode(position: Position): InlineImageNodeLike {
  return {
    type: 'inline-image',
    src: STALE_SRC,
    position,
    width: STALE_WIDTH,
    height: STALE_HEIGHT,
    targetCollectionPath: 'media',
    targetDocumentId: 'media-1',
    document: { title: 'Stale title' },
    children: [{ type: 'caption', children: [{ type: 'text' }] }],
  }
}

function applyTo(node: InlineImageNodeLike, image: StoredFileValue | undefined, title?: string) {
  inlineImageVisitor.match(node)?.apply({ fields: { image, ...(title ? { title } : {}) } })
}

describe('inlineImageVisitor', () => {
  describe('refreshes the editor preview from the resolved document', () => {
    it('refreshes a stale src and the document envelope', () => {
      const node = makeNode('left')

      applyTo(node, currentImage, 'Current title')

      expect(node.src).toBe('https://cdn.example.com/media/current-card.avif')
      expect(node.document).toEqual(
        expect.objectContaining({ title: 'Current title', image: currentImage })
      )
    })

    // The preview is position-aware by construction — the picker writes
    // `getPreferredSize(position, image)` into src/width/height at insert
    // time (inline-image-modal.tsx). Refreshing from `image.storageUrl`
    // instead would swap each variant for the full-size original.
    it.each([
      ['left' as Position, 'card', 600, 450],
      ['right' as Position, 'card', 600, 450],
      ['wide' as Position, 'desktop', 1600, 1200],
      ['full' as Position, 'tablet', 1024, 768],
      ['default' as Position, 'tablet', 1024, 768],
      [undefined, 'tablet', 1024, 768],
    ])(
      'position %s refreshes from the %s variant with its dimensions',
      (position, variant, width, height) => {
        const node = makeNode(position)

        applyTo(node, currentImage)

        expect(node.src).toBe(`https://cdn.example.com/media/current-${variant}.avif`)
        expect(node.width).toBe(width)
        expect(node.height).toBe(height)
      }
    )

    it('never refreshes src to the full-size original when a variant exists', () => {
      const node = makeNode('left')

      applyTo(node, currentImage)

      expect(node.src).not.toBe(currentImage.storageUrl)
    })

    it('falls back to the original when the preferred variant is missing', () => {
      const node = makeNode('left')

      applyTo(node, variantlessImage)

      expect(node.src).toBe(currentImage.storageUrl)
      expect(node.width).toBe(4000)
      expect(node.height).toBe(3000)
    })

    it('uses the original for SVGs, which have no variants', () => {
      const node = makeNode('left')
      const svg = {
        ...variantlessImage,
        mimeType: 'image/svg+xml',
        storageUrl: 'https://cdn.example.com/media/current.svg',
      } satisfies StoredFileValue

      applyTo(node, svg)

      expect(node.src).toBe('https://cdn.example.com/media/current.svg')
    })
  })

  describe('never serves a stale image when no current image is available', () => {
    it('clears the copied image and preview when the target cannot be read', async () => {
      const node = makeNode('left')
      node.document = { title: 'Stale title', altText: 'Stale alt', image: currentImage }
      const readDocuments = vi.fn().mockResolvedValue([])

      await runLexicalPopulate({
        readContext: createReadContext(),
        readDocuments,
        visitors: [inlineImageVisitor],
        values: [{ root: { type: 'root', children: [node] } }],
      })

      expect(readDocuments).toHaveBeenCalledWith({
        collectionPath: 'media',
        documentIds: ['media-1'],
      })
      expect(node.document).toEqual({ _resolved: false })
      expect(node.src).toBe('')
      expect(node.width).toBeUndefined()
      expect(node.height).toBeUndefined()
      // Identity and authored state survive.
      expect(node.targetDocumentId).toBe('media-1')
      expect(node.position).toBe('left')
      expect(node.children).toEqual([{ type: 'caption', children: [{ type: 'text' }] }])
    })

    it('clears the copied image and preview when the target resolves without an image', () => {
      const node = makeNode('left')
      node.document = { title: 'Old', image: currentImage, sizes: [{ name: 'card' }] }

      applyTo(node, undefined, 'Current title')

      expect(node.document).toEqual({ title: 'Current title', _resolved: false })
      expect(node.src).toBe('')
      expect(node.width).toBeUndefined()
      expect(node.height).toBeUndefined()
    })

    // Variant-less, so there is no usable variant URL to fall back to and
    // the original is the only candidate.
    it.each([undefined, '', '   '])(
      'clears the copied image and preview when the resolved storageUrl is %j',
      (storageUrl) => {
        const node = makeNode('left')
        node.document = { image: currentImage }

        applyTo(node, { ...variantlessImage, storageUrl })

        expect(node.document).toEqual({ _resolved: false })
        expect(node.src).toBe('')
        expect(node.width).toBeUndefined()
        expect(node.height).toBeUndefined()
      }
    )

    it('marks a node resolved again once a current image is available', () => {
      const node = makeNode('left')
      node.document = { _resolved: false }

      applyTo(node, currentImage)

      expect(node.document?._resolved).toBeUndefined()
      expect(node.document?.image).toEqual(currentImage)
      expect(node.src).toBe('https://cdn.example.com/media/current-card.avif')
    })

    it('exports no stale image to Markdown once the target is unavailable', async () => {
      const node = { ...makeNode('left'), altText: 'authored alt' }
      await runLexicalPopulate({
        readContext: createReadContext(),
        readDocuments: vi.fn().mockResolvedValue([]),
        visitors: [inlineImageVisitor],
        values: [{ root: { type: 'root', children: [node] } }],
      })
      const markdown = lexicalToMarkdown({ root: { type: 'root', children: [node] } }).markdown

      expect(markdown).not.toContain(STALE_SRC)
      expect(node.altText, 'authored alt text is not target data').toBe('authored alt')
    })
  })

  it('is idempotent and leaves unrelated node state untouched', () => {
    const node = makeNode('left')
    const children = node.children
    const pending = inlineImageVisitor.match(node)

    pending?.apply({ fields: { image: currentImage } })
    const afterFirst = { src: node.src, width: node.width, height: node.height }
    pending?.apply({ fields: { image: currentImage } })

    expect({ src: node.src, width: node.width, height: node.height }).toEqual(afterFirst)
    expect(node.position).toBe('left')
    expect(node.children).toBe(children)
    expect(node.children).toEqual([{ type: 'caption', children: [{ type: 'text' }] }])
  })
})

describe('inlineImageVisitor replaces derived values instead of merging them', () => {
  it('removes a stale title and alt text while a valid current image still renders', () => {
    const node = makeNode('left')
    node.document = { title: 'Withheld ES', altText: 'Texto alternativo', caption: 'kept' }

    inlineImageVisitor.match(node)?.apply({ fields: { image: currentImage } })

    expect(node.document).not.toHaveProperty('title')
    expect(node.document).not.toHaveProperty('altText')
    expect(node.document?.caption, 'unrelated envelope keys are kept').toBe('kept')
    expect(node.document?.image).toEqual(currentImage)
    expect(node.document?._resolved).toBeUndefined()
    expect(node.src).toBe('https://cdn.example.com/media/current-card.avif')
  })
})
