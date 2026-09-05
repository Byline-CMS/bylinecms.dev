import { ERR_DOCUMENT_HOOK_COMMITTED, type StoredFileValue } from '@byline/core'
import { replaceDocumentFieldsPreservingStatus } from '@byline/core/services'
import { describe, expect, it } from 'vitest'

import {
  assertCompleteVariantSet,
  mediaFailureOutcome,
  replaceMediaVersionPreservingStatus,
  storedFilePaths,
} from './regenerate-media-operation.js'

function storedFile(variantNames: string[]): StoredFileValue {
  return {
    fileId: 'file-1',
    filename: 'image.jpg',
    originalFilename: 'image.jpg',
    mimeType: 'image/jpeg',
    fileSize: 10,
    storageProvider: 'local',
    storagePath: 'media/new-image.jpg',
    processingStatus: 'complete',
    variants: variantNames.map((name) => ({
      name,
      storagePath: `media/new-image-${name}.avif`,
      width: 100,
      height: 100,
      format: 'avif',
    })),
  }
}

describe('regenerate-media operation', () => {
  it('accepts exactly the schema-declared variant set regardless of order', () => {
    expect(() =>
      assertCompleteVariantSet(storedFile(['card', 'thumbnail']), ['thumbnail', 'card'])
    ).not.toThrow()
  })

  it('rejects missing, extra, and duplicate variants', () => {
    expect(() =>
      assertCompleteVariantSet(storedFile(['thumbnail']), ['thumbnail', 'card'])
    ).toThrow(/incomplete variant set/)
    expect(() =>
      assertCompleteVariantSet(storedFile(['thumbnail', 'card']), ['thumbnail'])
    ).toThrow(/incomplete variant set/)
    expect(() =>
      assertCompleteVariantSet(storedFile(['thumbnail', 'thumbnail']), ['thumbnail'])
    ).toThrow(/incomplete variant set/)
  })

  it('collects the original and variant storage paths without duplicates', () => {
    const value = storedFile(['thumbnail'])
    value.variants?.push({
      name: 'duplicate-path',
      storagePath: value.storagePath,
      width: 100,
      height: 100,
      format: 'avif',
    })
    expect([...storedFilePaths(value)]).toEqual([
      'media/new-image.jpg',
      'media/new-image-thumbnail.avif',
    ])
  })

  // The four former pending behaviors execute against both real adapters in
  // db-conformance/src/suites/guarded-saves.ts, Task 6 / T5-1. This alias check
  // ensures those tests exercise the script entry point without an adapter double.
  it('uses the guarded entry point covered by the real-adapter maintenance suite', () => {
    expect(replaceMediaVersionPreservingStatus).toBe(replaceDocumentFieldsPreservingStatus)
  })
  it('retains prepared files when a replacement committed before its after-hook failed', () => {
    const error = ERR_DOCUMENT_HOOK_COMMITTED({
      message: 'afterUpdate failed',
      details: {
        phase: 'afterUpdate',
        documentId: 'doc-1',
        documentVersionId: 'version-2',
        revision: 2,
        sideEffectCode: 'ERR_UNHANDLED',
      },
    })
    expect(
      mediaFailureOutcome(
        error,
        new Set(['new-image.avif', 'original.jpg']),
        new Set(['original.jpg'])
      )
    ).toEqual({ committed: true, revision: 2, cleanupPaths: new Set() })
  })
  it('discards only fresh paths when the document write was rejected', () => {
    expect(
      mediaFailureOutcome(
        new Error('stale write'),
        new Set(['new-image.avif', 'original.jpg']),
        new Set(['original.jpg'])
      )
    ).toEqual({ committed: false, cleanupPaths: new Set(['new-image.avif']) })
  })
})
