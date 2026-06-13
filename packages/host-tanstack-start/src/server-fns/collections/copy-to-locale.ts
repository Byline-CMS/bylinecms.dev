/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger, getServerConfig } from '@byline/core'
import type { CopyToLocaleResult, DocumentLifecycleContext } from '@byline/core/services'
import { copyToLocale } from '@byline/core/services'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Copy document content from one locale into another
// ---------------------------------------------------------------------------

/**
 * Copy a document's content from `sourceLocale` into `targetLocale` on
 * the same document. Mirrors the thin-wrapper pattern of the other
 * collection server fns: resolve the request context, build the
 * lifecycle context, delegate to the `copyToLocale` service.
 *
 * `assertActorCanPerform('update')` runs inside the service; auth
 * failures propagate to TanStack Start's transport layer.
 */
export const copyDocumentToLocale = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      id: string
      sourceLocale: string
      targetLocale: string
      overwrite: boolean
    }) => input
  )
  .handler(async ({ data: input }): Promise<CopyToLocaleResult> => {
    const { collection: path, id, sourceLocale, targetLocale, overwrite } = input
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

    return copyToLocale(ctx, {
      documentId: id,
      sourceLocale,
      targetLocale,
      overwrite,
    })
  })
