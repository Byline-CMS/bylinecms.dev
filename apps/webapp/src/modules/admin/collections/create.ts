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
import { createDocument } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'
import { getAdminRequestContext } from '@/lib/auth-context'

// ---------------------------------------------------------------------------
// Create document
// ---------------------------------------------------------------------------

export const createCollectionDocument = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { collection: string; data: any; locale?: string; path?: string }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, data: documentData, locale, path: explicitPath } = input
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

    await createDocument(ctx, {
      data: structuredClone(documentData),
      status: documentData.status,
      locale: locale ?? serverConfig.i18n.content.defaultLocale,
      path: explicitPath,
    })

    return { status: 'ok' as const }
  })
