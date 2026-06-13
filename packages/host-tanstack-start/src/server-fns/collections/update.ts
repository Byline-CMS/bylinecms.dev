/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import { ERR_NOT_FOUND, getLogger, getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import type { DocumentLifecycleContext } from '@byline/core/services'
import { updateDocumentSystemFields, updateDocumentWithPatches } from '@byline/core/services'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Apply patches (patch-based update — creates a new immutable version)
//
// Document-grain system fields (`path`, `availableLocales`) are deliberately
// NOT handled here: they are written through their own non-versioned path
// (`updateCollectionDocumentSystemFields` below) so that editing them does not
// mint a new version or reset workflow status. See docs/I18N.md.
// ---------------------------------------------------------------------------

export const updateCollectionDocumentWithPatches = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      id: string
      patches: DocumentPatch[]
      versionId?: string
      locale?: string
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, id, patches, versionId, locale } = input
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

    await updateDocumentWithPatches(ctx, {
      documentId: id,
      patches,
      documentVersionId: versionId,
      locale: locale ?? serverConfig.i18n.content.defaultLocale,
    })

    return { status: 'ok' as const }
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
      locale?: string
      /** Path override; `null`/omitted means no path write. */
      path?: string | null
      /** Editorial advertised-locale set; omitted means no advertised-locale write. */
      availableLocales?: string[]
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, id, locale, path: explicitPath, availableLocales } = input
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

    await updateDocumentSystemFields(ctx, {
      documentId: id,
      locale: locale ?? serverConfig.i18n.content.defaultLocale,
      path: explicitPath,
      availableLocales,
    })

    return { status: 'ok' as const }
  })
