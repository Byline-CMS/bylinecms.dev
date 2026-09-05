/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminRequestContext } from '@byline/client/server'
import { ERR_NOT_FOUND, getLogger, getServerConfig, reorderDocument } from '@byline/core'

import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Reorder a single document within an `orderable: true` collection.
//
// One of `beforeDocumentId` / `afterDocumentId` should be provided — they
// identify the neighbours the dragged row should land between. Either may
// be null:
//   - both null    → append to the end; retain the key if already there
//   - beforeId set, afterId null   → append after `beforeId`
//   - beforeId null, afterId set   → prepend before `afterId`
//
// Updates ordering and any necessary sibling-key repairs in one guarded
// transaction, without creating content versions. Uses `collections.<path>.update`;
// reordering is metadata-level update, not a new ability slug.
// ---------------------------------------------------------------------------

export const reorderCollectionDocument = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      expectedRevision: number
      collection: string
      documentId: string
      beforeDocumentId?: string | null
      afterDocumentId?: string | null
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, documentId, beforeDocumentId, afterDocumentId } = input
    const logger = getLogger()

    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const serverConfig = getServerConfig()
    const result = await reorderDocument(
      {
        db: serverConfig.db,
        definition: config.definition,
        collectionId: config.collection.id,
        collectionVersion: config.collection.version,
        collectionPath: path,
        requestContext: await getAdminRequestContext(),
        logger,
        defaultLocale: serverConfig.i18n.content.defaultLocale,
        slugifier: serverConfig.slugifier,
      },
      { documentId, expectedRevision: input.expectedRevision, beforeDocumentId, afterDocumentId }
    )
    return { status: 'ok' as const, ...result }
  })
