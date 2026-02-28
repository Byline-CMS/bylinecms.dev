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
import { createDocument } from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

// ---------------------------------------------------------------------------
// Create document
// ---------------------------------------------------------------------------

export const createCollectionDocument = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; data: any; locale?: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, data: documentData, locale } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    await createDocument(ctx, {
      data: structuredClone(documentData),
      status: documentData.status,
      locale: locale ?? 'en',
    })

    return { status: 'ok' as const }
  })
