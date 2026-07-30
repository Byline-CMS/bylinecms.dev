/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { StoredFileValue } from '@byline/core'
import { describe, expect, test, vi } from 'vitest'

import {
  collectImageUrls,
  mediaPathForUrl,
  mimeTypeFromContentType,
  persistUploadedMediaDocument,
} from './media-ingest.js'
import { parseBodyToMdast } from './parse-markdown.js'

// Stand-in for `slugify` from @byline/core — the real one needs a locale and
// collection path, and these tests are about the filename derivation, not the
// slug algorithm.
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

describe('collectImageUrls', () => {
  test('finds standalone and inline images in source order', () => {
    const urls = collectImageUrls(
      parseBodyToMdast('![one](./a.png)\n\ntext ![two](./b.svg) more\n')
    )
    expect(urls).toEqual(['./a.png', './b.svg'])
  })

  test('collapses repeats of the same URL to a single entry', () => {
    const urls = collectImageUrls(parseBodyToMdast('![a](./x.png)\n\n![b](./x.png)\n'))
    expect(urls).toEqual(['./x.png'])
  })

  test('descends into nested containers', () => {
    const urls = collectImageUrls(
      parseBodyToMdast('- item ![in-list](./l.png)\n\n> quote ![in-quote](./q.png)\n')
    )
    expect(urls).toEqual(['./l.png', './q.png'])
  })

  test('a document with no images yields an empty list', () => {
    expect(collectImageUrls(parseBodyToMdast('# just prose\n'))).toEqual([])
  })
})

describe('mediaPathForUrl', () => {
  test('derives the path from the filename, dropping directory and extension', () => {
    expect(mediaPathForUrl('./images/byline-deployment-1.svg', slug)).toBe('byline-deployment-1')
  })

  test('a local and a remote copy of the same filename key to the same path', () => {
    // This is what makes re-imports idempotent regardless of where the image
    // was referenced from.
    expect(mediaPathForUrl('./images/diagram.svg', slug)).toBe(
      mediaPathForUrl('https://example.com/assets/diagram.svg', slug)
    )
  })

  test('query strings and fragments are stripped before the extension', () => {
    expect(mediaPathForUrl('https://example.com/pic.png?v=2#frag', slug)).toBe('pic')
  })

  test('a filename needing slugification is slugified', () => {
    expect(mediaPathForUrl('./My Diagram (v2).PNG', slug)).toBe('my-diagram-v2')
  })

  test('a filename that slugifies to nothing falls back to a stable hash', () => {
    const first = mediaPathForUrl('./___.png', slug)
    expect(first).toMatch(/^image-[0-9a-f]{12}$/)
    // Stable across calls, so a re-import still dedupes.
    expect(mediaPathForUrl('./___.png', slug)).toBe(first)
    // Distinct sources do not collide.
    expect(mediaPathForUrl('./+++.png', slug)).not.toBe(first)
  })
})

describe('mimeTypeFromContentType', () => {
  test('accepts a served type the media collection allows', () => {
    expect(mimeTypeFromContentType('image/png')).toBe('image/png')
    expect(mimeTypeFromContentType('image/svg+xml')).toBe('image/svg+xml')
  })

  test('rejects anything outside the allowed set', () => {
    // The header is not trustworthy on its own; uploadField validates against
    // upload.mimeTypes regardless, so this is belt and braces.
    expect(mimeTypeFromContentType('text/html')).toBeNull()
    expect(mimeTypeFromContentType('application/octet-stream')).toBeNull()
  })

  test('a missing header yields null rather than throwing', () => {
    expect(mimeTypeFromContentType(null)).toBeNull()
  })
})

describe('persistUploadedMediaDocument', () => {
  const storedFile: StoredFileValue = {
    fileId: 'file-1',
    filename: 'diagram.png',
    originalFilename: 'diagram.png',
    mimeType: 'image/png',
    fileSize: 100,
    storageProvider: 'local',
    storagePath: 'media/diagram.png',
    processingStatus: 'complete',
    variants: [
      {
        name: 'tablet',
        storagePath: 'media/diagram-tablet.avif',
        width: 1024,
        height: 768,
        format: 'avif',
      },
    ],
  }

  test('returns the new document ID without deleting a successful upload', async () => {
    const deleteFile = vi.fn()
    const createDocument = vi.fn().mockResolvedValue({ documentId: 'media-new' })

    await expect(
      persistUploadedMediaDocument({ delete: deleteFile }, storedFile, createDocument)
    ).resolves.toBe('media-new')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  test('deletes the new source and variants when document creation fails', async () => {
    const failure = new Error('document create failed')
    const deleteFile = vi.fn().mockResolvedValue(undefined)

    await expect(
      persistUploadedMediaDocument(
        { delete: deleteFile },
        storedFile,
        vi.fn().mockRejectedValue(failure)
      )
    ).rejects.toBe(failure)
    expect(deleteFile.mock.calls.map(([storagePath]) => storagePath)).toEqual([
      'media/diagram.png',
      'media/diagram-tablet.avif',
    ])
  })

  test('does not mask the document failure when cleanup also fails', async () => {
    const failure = new Error('document create failed')
    const cleanupFailure = new Error('storage unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(
      persistUploadedMediaDocument(
        { delete: vi.fn().mockRejectedValue(cleanupFailure) },
        storedFile,
        vi.fn().mockRejectedValue(failure)
      )
    ).rejects.toBe(failure)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not remove orphaned 'media/diagram.png'")
    )
    warn.mockRestore()
  })
})
