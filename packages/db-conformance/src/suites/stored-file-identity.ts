/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { CollectionDefinition, IDbAdapter, StoredFileValue } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

/**
 * Stored-file values survive version copies. Upload fields are not
 * localizable, so file rows are stored at locale 'all'; deleting a content
 * locale mints a new version through the adapter's full version copy, which
 * must carry every file column — including `variants`.
 */
export function storedFileIdentitySuite(hooks: ConformanceHooks): void {
  const ts = Date.now()
  const FilesCollection: CollectionDefinition = {
    path: `stored-file-identity-${ts}`,
    labels: { singular: 'File', plural: 'Files' },
    fields: [
      { name: 'title', type: 'text', localized: true },
      { name: 'image', type: 'image', optional: true },
    ],
  }

  let adapter: IDbAdapter
  let filesId = ''

  const file = (storagePath: string, extra?: Partial<StoredFileValue>): StoredFileValue => ({
    fileId: crypto.randomUUID(),
    filename: storagePath.split('/').pop() ?? 'file.bin',
    originalFilename: 'original.bin',
    mimeType: 'image/png',
    fileSize: 3,
    storageProvider: 'local',
    storagePath,
    processingStatus: 'complete',
    ...extra,
  })

  describe('stored-file identity', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([FilesCollection])
      const files = await adapter.commands.collections.create(FilesCollection.path, FilesCollection)
      filesId = files[0]?.id as string
    })

    afterAll(async () => {
      await adapter.commands.collections.delete(filesId).catch(() => undefined)
    })

    it('carries variants through a locale-deletion version copy', async () => {
      const variants = [{ name: 'card', storagePath: 'identity/card.webp', width: 320 }]
      const v1 = await adapter.commands.documents.createDocumentVersion({
        collectionId: filesId,
        collectionVersion: 1,
        collectionConfig: FilesCollection,
        action: 'create',
        documentData: {
          title: { en: 'English', fr: 'Français' },
          image: file('identity/photo.png', { variants }),
        },
        path: `doc-${crypto.randomUUID()}`,
      })

      const deleted = await adapter.commands.documents.deleteDocumentLocale({
        documentId: v1.document.document_id,
        locale: 'fr',
      })
      expect(deleted).not.toBeNull()

      const doc = await adapter.queries.documents.getDocumentByVersion({
        document_version_id: deleted?.newVersionId as string,
        locale: 'all',
      })
      const image = ((doc?.fields ?? {}) as Record<string, any>).image
      expect(image.storagePath).toBe('identity/photo.png')
      expect(image.variants).toEqual([
        expect.objectContaining({ name: 'card', storagePath: 'identity/card.webp', width: 320 }),
      ])
    })
  })
}
