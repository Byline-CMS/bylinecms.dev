/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { deleteDocument as deleteDocumentService } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

// ---------------------------------------------------------------------------
// Delete document (soft-delete — marks all versions as deleted)
// ---------------------------------------------------------------------------

export const deleteDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const serverConfig = getServerConfig()
    // Resolve the storage provider so the lifecycle service can clean up
    // uploaded files and variants on deletion.
    const storage = config.definition.upload?.storage ?? serverConfig.storage
    const db = serverConfig.db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
      ...(storage ? { storage } : {}),
    }

    try {
      const result = await deleteDocumentService(ctx, { documentId: id })
      return { status: 'ok' as const, deletedVersionCount: result.deletedVersionCount }
    } catch (err: any) {
      if (err.name === 'DocumentNotFoundError') throw new Error('Document not found')
      throw err
    }
  })
