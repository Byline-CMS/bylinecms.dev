/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger, getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { restoreDocumentVersion as restoreDocumentVersionService } from '@byline/core/services'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Restore a historical document version as the new current version
// ---------------------------------------------------------------------------

export const restoreDocumentVersion = createServerFn({ method: 'POST' })
  .validator((input: { collection: string; id: string; versionId: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id, versionId } = input
    const logger = getLogger()
    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    const serverConfig = getServerConfig()
    const ctx: DocumentLifecycleContext = {
      db: serverConfig.db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionVersion: config.collection.version,
      collectionPath: path,
      logger,
      defaultLocale: serverConfig.i18n.content.defaultLocale,
      slugifier: serverConfig.slugifier,
      requestContext: await getAdminRequestContext(),
    }

    const result = await restoreDocumentVersionService(ctx, {
      documentId: id,
      sourceVersionId: versionId,
    })

    return {
      status: 'ok' as const,
      documentId: result.documentId,
      documentVersionId: result.documentVersionId,
      sourceVersionId: result.sourceVersionId,
    }
  })
