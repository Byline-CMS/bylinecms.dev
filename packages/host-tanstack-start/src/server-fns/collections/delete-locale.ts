/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger, getServerConfig } from '@byline/core'
import type { DeleteLocaleResult, DocumentLifecycleContext } from '@byline/core/services'
import { deleteLocale } from '@byline/core/services'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Delete one content locale's data from a document
// ---------------------------------------------------------------------------

/**
 * Remove a single (non-default) content locale from a document, leaving every
 * other locale untouched. Mirrors the thin-wrapper pattern of the other
 * collection server fns: resolve the request context, build the lifecycle
 * context, delegate to the `deleteLocale` service.
 *
 * `assertActorCanPerform('update')` and the default-locale guard run inside
 * the service; auth and validation failures propagate to TanStack Start's
 * transport layer.
 */
export const deleteDocumentLocale = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string; locale: string }) => input)
  .handler(async ({ data: input }): Promise<DeleteLocaleResult> => {
    const { collection: path, id, locale } = input
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

    return deleteLocale(ctx, { documentId: id, locale })
  })
