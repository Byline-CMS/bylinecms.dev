/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import type { DocumentLifecycleContext } from '@byline/core/services'
import {
  ConflictError,
  PatchApplicationError,
  updateDocumentWithPatches,
} from '@byline/core/services'

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
    }

    try {
      await updateDocumentWithPatches(ctx, {
        documentId: id,
        patches,
        documentVersionId: document_version_id,
        locale: locale ?? 'en',
      })
    } catch (error) {
      if (error instanceof ConflictError) {
        const err = new Error(`Conflict: ${error.message}`) as Error & {
          currentVersionId?: string
          yourVersionId?: string
        }
        err.currentVersionId = error.currentVersionId
        err.yourVersionId = error.yourVersionId
        throw err
      }
      if (error instanceof PatchApplicationError) {
        throw new Error(`Failed to apply patches: ${(error.errors ?? []).join(', ')}`)
      }
      throw error
    }

    return { status: 'ok' as const }
  })
