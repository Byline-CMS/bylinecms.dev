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

  describe('never leaves the node emptier than it found it', () => {
    it('preserves src, width and height when the target cannot be resolved', async () => {
      const node = makeNode('left')
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
      expect(node.src).toBe(STALE_SRC)
      expect(node.width).toBe(STALE_WIDTH)
      expect(node.height).toBe(STALE_HEIGHT)
    })

    it('preserves the preview when the target resolves without an image', () => {
      const node = makeNode('left')

      applyTo(node, undefined, 'Current title')

      expect(node.src).toBe(STALE_SRC)
      expect(node.width).toBe(STALE_WIDTH)
      expect(node.height).toBe(STALE_HEIGHT)
      expect(node.document).toEqual(expect.objectContaining({ title: 'Current title' }))
    })

    // Variant-less, so there is no usable variant URL to fall back to and
    // the original is the only candidate — exactly the case the guard is for.
    it.each([undefined, '', '   '])(
      'preserves the preview when the resolved storageUrl is %j',
      (storageUrl) => {
        const node = makeNode('left')

        applyTo(node, { ...variantlessImage, storageUrl })

        expect(node.src).toBe(STALE_SRC)
        expect(node.width).toBe(STALE_WIDTH)
        expect(node.height).toBe(STALE_HEIGHT)
      }
    )
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
