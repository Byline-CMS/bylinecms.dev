import type { CollectionDefinition, IDbAdapter, StoredFileValue } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import {
  assertCompleteVariantSet,
  replaceMediaVersionPreservingStatus,
  storedFilePaths,
} from './regenerate-media-operation.js'

const definition = {
  path: 'media',
  workflow: {
    statuses: [
      { name: 'draft', label: 'Draft', verb: 'Save as Draft' },
      { name: 'published', label: 'Published', verb: 'Publish' },
      { name: 'archived', label: 'Archived', verb: 'Archive' },
    ],
  },
  fields: [],
} as unknown as CollectionDefinition

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

function operation(targetStatus: string) {
  const events: string[] = []
  const update = vi.fn(async () => {
    events.push('update')
    return { documentId: 'doc-1', documentVersionId: 'version-new' }
  })
  const setDocumentStatus = vi.fn(async () => {
    events.push(`status:${targetStatus}`)
  })
  const archivePublishedVersions = vi.fn(async () => {
    events.push('archive-previous-published')
    return 1
  })
  const append = vi.fn(async () => {
    events.push('audit')
    return { id: 'audit-1' }
  })
  const db = {
    commands: {
      documents: { setDocumentStatus, archivePublishedVersions },
      audit: { append },
    },
    withTransaction: async <T>(run: () => Promise<T>) => {
      events.push('transaction:start')
      const result = await run()
      events.push('transaction:commit')
      return result
    },
  } as unknown as IDbAdapter

  const run = () =>
    replaceMediaVersionPreservingStatus({
      db,
      definition,
      collectionId: 'collection-1',
      handle: { update },
      documentId: 'doc-1',
      fields: { title: 'Image' },
      targetStatus,
    })

  return { append, archivePublishedVersions, events, run, setDocumentStatus, update }
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

  it('keeps a draft replacement at draft without a metadata mutation', async () => {
    const state = operation('draft')
    await state.run()
    expect(state.events).toEqual(['transaction:start', 'update', 'transaction:commit'])
    expect(state.setDocumentStatus).not.toHaveBeenCalled()
    expect(state.archivePublishedVersions).not.toHaveBeenCalled()
    expect(state.append).not.toHaveBeenCalled()
  })

  it('restores archived directly without passing through published', async () => {
    const state = operation('archived')
    await state.run()
    expect(state.events).toEqual([
      'transaction:start',
      'update',
      'status:archived',
      'audit',
      'transaction:commit',
    ])
    expect(state.archivePublishedVersions).not.toHaveBeenCalled()
  })

  it('publishes and archives the previous published version in the same transaction', async () => {
    const state = operation('published')
    await state.run()
    expect(state.events).toEqual([
      'transaction:start',
      'update',
      'status:published',
      'archive-previous-published',
      'audit',
      'transaction:commit',
    ])
    expect(state.archivePublishedVersions).toHaveBeenCalledWith({
      document_id: 'doc-1',
      excludeVersionId: 'version-new',
    })
  })

  it('rejects a stale captured status before opening a transaction', async () => {
    const state = operation('removed-status')
    await expect(state.run()).rejects.toThrow(/is not declared/)
    expect(state.events).toEqual([])
  })
})
