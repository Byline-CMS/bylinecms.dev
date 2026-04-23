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
import {
  changeDocumentStatus,
  unpublishDocument as unpublishDocumentService,
} from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'
import { getAdminRequestContext } from '@/lib/auth-context'

// ---------------------------------------------------------------------------
// Change document workflow status
// ---------------------------------------------------------------------------

export const updateDocumentStatus = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string; status: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id, status: nextStatus } = input
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

    const result = await changeDocumentStatus(ctx, {
      documentId: id,
      nextStatus,
    })
    return {
      status: 'ok' as const,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
    }
  })

// ---------------------------------------------------------------------------
// Unpublish document (archive the live published version)
// ---------------------------------------------------------------------------

export const unpublishDocument = createServerFn({ method: 'POST' })
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

    const result = await unpublishDocumentService(ctx, { documentId: id })

    if (result.archivedCount === 0) {
      throw ERR_NOT_FOUND({
        message: 'No published version found for this document',
        details: { documentId: id, collectionPath: path },
      }).log(logger)
    }

    return { status: 'ok' as const, archivedCount: result.archivedCount }
  })
