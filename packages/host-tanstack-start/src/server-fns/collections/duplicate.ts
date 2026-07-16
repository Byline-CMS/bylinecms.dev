/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getAdminRequestContext } from '@byline/client/server'
import { ERR_NOT_FOUND, getLogger, getServerConfig } from '@byline/core'
import type { DocumentLifecycleContext, DuplicateDocumentResult } from '@byline/core/services'
import { duplicateDocument } from '@byline/core/services'

import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Duplicate document
// ---------------------------------------------------------------------------

/**
 * Duplicate an existing document — clones all locales into a brand-new
 * document in one atomic write. Returns the new document's id so the UI
 * can navigate straight to its edit view.
 *
 * Mirrors the thin-wrapper pattern of the other collection server fns:
 * resolve the request context from session cookies, build the lifecycle
 * context, delegate to the `duplicateDocument` service. The service runs
 * `assertActorCanPerform(..., 'create')`; any auth failure propagates to
 * TanStack Start's transport layer for the client to branch on.
 */
export const duplicateCollectionDocument = createServerFn({ method: 'POST' })
  .validator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }): Promise<DuplicateDocumentResult> => {
    const { collection: path, id: sourceDocumentId } = input
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

    return duplicateDocument(ctx, { sourceDocumentId })
  })
