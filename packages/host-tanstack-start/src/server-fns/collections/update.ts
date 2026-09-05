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
import type { DocumentPatch } from '@byline/core/patches'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { saveDocument, updateDocumentSystemFields } from '@byline/core/services'

import { ensureCollection } from '../../integrations/api-utils.js'
import { toCommittedDocumentHookFailureResponse } from './save-outcome.js'

// ---------------------------------------------------------------------------
// Save content patches and optional metadata in one guarded transaction.
// Empty patches retain the non-versioned metadata-only behavior.
// ---------------------------------------------------------------------------

export const updateCollectionDocumentWithPatches = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      id: string
      patches: DocumentPatch[]
      expectedRevision: number
      path?: string | null
      availableLocales?: string[]
      locale?: string
    }) => input
  )
  .handler(async ({ data: input }) => {
    const {
      collection: path,
      id,
      patches,
      expectedRevision,
      locale,
      path: explicitPath,
      availableLocales,
    } = input
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

    let result: Awaited<ReturnType<typeof saveDocument>>
    try {
      result = await saveDocument(ctx, {
        documentId: id,
        patches,
        expectedRevision,
        path: explicitPath ?? undefined,
        availableLocales,
        locale: locale ?? serverConfig.i18n.content.defaultLocale,
      })
    } catch (error) {
      const committedFailure = toCommittedDocumentHookFailureResponse(error)
      if (committedFailure != null) return committedFailure
      throw error
    }

    return {
      status: 'ok' as const,
      documentId: result.documentId,
      ...('documentVersionId' in result ? { documentVersionId: result.documentVersionId } : {}),
      revision: result.revision,
    }
  })

// ---------------------------------------------------------------------------
// System-managed, document-grain fields (path + advertised locales)
//
// Non-versioned, immediate write — does NOT create a new version or change
// workflow status. Backs the admin path / available-locales widgets'
// direct-write Save (the `direct-write` and `both` dirty-reason cases).
// ---------------------------------------------------------------------------

export const updateCollectionDocumentSystemFields = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      id: string
      expectedRevision: number
      locale?: string
      /** Path override; `null`/omitted means no path write. */
      path?: string | null
      /** Editorial advertised-locale set; omitted means no advertised-locale write. */
      availableLocales?: string[]
    }) => input
  )
  .handler(async ({ data: input }) => {
    const {
      collection: path,
      id,
      expectedRevision,
      locale,
      path: explicitPath,
      availableLocales,
    } = input
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

    try {
      const result = await updateDocumentSystemFields(ctx, {
        expectedRevision,
        documentId: id,
        locale: locale ?? serverConfig.i18n.content.defaultLocale,
        path: explicitPath,
        availableLocales,
        // Reconciliation still requires a current observation.
        reconcile: true,
      })
      return { status: 'ok' as const, revision: result.revision }
    } catch (error) {
      const committedFailure = toCommittedDocumentHookFailureResponse(error)
      if (committedFailure != null) return committedFailure
      throw error
    }
  })
