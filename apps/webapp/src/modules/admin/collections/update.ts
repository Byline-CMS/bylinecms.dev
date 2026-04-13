/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { BylineError, ErrorCodes, getLogger, getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { updateDocumentWithPatches } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

// ---------------------------------------------------------------------------
// Apply patches (patch-based update — creates a new immutable version)
// ---------------------------------------------------------------------------

export const updateCollectionDocumentWithPatches = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      collection: string
      id: string
      patches: DocumentPatch[]
      document_version_id?: string
      locale?: string
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, id, patches, document_version_id, locale } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
      logger: getLogger(),
    }

    try {
      await updateDocumentWithPatches(ctx, {
        documentId: id,
        patches,
        documentVersionId: document_version_id,
        locale: locale ?? 'en',
      })
    } catch (error) {
      if (error instanceof BylineError) {
        if (error.code === ErrorCodes.CONFLICT || error.code === ErrorCodes.PATCH_FAILED) {
          throw error
        }
      }
      throw error
    }

    return { status: 'ok' as const }
  })
