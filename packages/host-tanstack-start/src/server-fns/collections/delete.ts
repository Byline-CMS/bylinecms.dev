/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger, getServerConfig, getUploadFields } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { deleteDocument as deleteDocumentService } from '@byline/core/services'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Delete document (soft-delete — marks all versions as deleted)
// ---------------------------------------------------------------------------

export const deleteDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id } = input
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const serverConfig = getServerConfig()
    // Resolve the storage provider so the lifecycle service can clean up
    // uploaded files and variants on deletion. With per-field upload
    // config, a collection may have one (or more) image/file fields with
    // their own storage. The delete path needs *a* provider; we pick the
    // first upload-capable field's, falling back to the site-wide
    // default. Multi-storage collections are out of scope today —
    // deletion routes everything through one provider, which is fine
    // when all upload fields target the same backend (the common case).
    const firstUploadField = getUploadFields(config.definition)[0]
    const storage = firstUploadField?.upload?.storage ?? serverConfig.storage
    const db = serverConfig.db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionVersion: config.collection.version,
      collectionPath: path,
      ...(storage ? { storage } : {}),
      logger,
      defaultLocale: serverConfig.i18n.content.defaultLocale,
      slugifier: serverConfig.slugifier,
      requestContext: await getAdminRequestContext(),
    }

    const result = await deleteDocumentService(ctx, { documentId: id })
    return { status: 'ok' as const, deletedVersionCount: result.deletedVersionCount }
  })
