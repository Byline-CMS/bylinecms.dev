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
import {
  changeDocumentStatus,
  DocumentNotFoundError,
  InvalidTransitionError,
  unpublishDocument as unpublishDocumentService,
} from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

// ---------------------------------------------------------------------------
// Change document workflow status
// ---------------------------------------------------------------------------

export const updateDocumentStatus = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { collection: string; id: string; status: string; locale?: string }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, id, status: nextStatus, locale } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    try {
      const result = await changeDocumentStatus(ctx, {
        documentId: id,
        nextStatus,
        locale: locale ?? 'en',
      })
      return {
        status: 'ok' as const,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
      }
    } catch (error) {
      if (error instanceof DocumentNotFoundError) throw new Error('Document not found')
      if (error instanceof InvalidTransitionError)
        throw new Error(`Invalid transition: ${error.message}`)
      throw error
    }
  })

// ---------------------------------------------------------------------------
// Unpublish document (archive the live published version)
// ---------------------------------------------------------------------------

export const unpublishDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    const result = await unpublishDocumentService(ctx, { documentId: id })

    if (result.archivedCount === 0) throw new Error('No published version found for this document')

    return { status: 'ok' as const, archivedCount: result.archivedCount }
  })
