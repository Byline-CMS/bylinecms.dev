/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createServerFn } from '@tanstack/react-start'

import {
  assertActorCanPerform,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  generateKeyBetween,
  generateNKeysBetween,
  getLogger,
  getServerConfig,
} from '@byline/core'

import { getAdminRequestContext } from '../../auth/auth-context.js'
import { ensureCollection } from '../../integrations/api-utils.js'

// ---------------------------------------------------------------------------
// Reorder a single document within an `orderable: true` collection.
//
// One of `beforeDocumentId` / `afterDocumentId` should be provided — they
// identify the neighbours the dragged row should land between. Either may
// be null:
//   - both null    → empty collection or "append-to-end" no-op (writes
//                     a fresh key)
//   - beforeId set, afterId null   → append after `beforeId`
//   - beforeId null, afterId set   → prepend before `afterId`
//
// Writes a single column on `byline_documents` and does NOT create a new
// document version. Goes through the `collections.<path>.update` ability;
// reordering is metadata-level update, not a new ability slug.
// ---------------------------------------------------------------------------

export const reorderCollectionDocument = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      collection: string
      documentId: string
      beforeDocumentId?: string | null
      afterDocumentId?: string | null
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, documentId, beforeDocumentId, afterDocumentId } = input
    const logger = getLogger()

    const config = await ensureCollection(path)
    if (!config) {
      throw ERR_NOT_FOUND({
        message: 'Collection not found',
        details: { collectionPath: path },
      }).log(logger)
    }

    if (config.definition.orderable !== true) {
      throw ERR_VALIDATION({
        message: `collection '${path}' is not orderable; set \`orderable: true\` on its collection definition to enable reordering`,
        details: { collectionPath: path },
      }).log(logger)
    }

    const requestContext = await getAdminRequestContext()
    assertActorCanPerform(requestContext, path, 'update')

    const serverConfig = getServerConfig()
    const collectionId = config.collection.id

    // Read the whole collection in canonical display order. Small by design
    // for orderable use cases (bios, FAQs, sections), so a full read is
    // cheap — and it gives us a single, consistent snapshot to reason about
    // both backfill and recovery in one pass.
    const canonical = await serverConfig.db.queries.documents.getCanonicalDocumentOrder({
      collection_id: collectionId,
    })

    // Detect pathological key state — duplicates or non-ascending runs of
    // keyed rows. These can land in the DB from prior buggy code paths
    // or interrupted writes; once present, `generateKeyBetween` throws
    // with `a >= b`. When detected, re-key the entire collection in the
    // editor's current visible order so subsequent operations work from
    // a clean baseline.
    let corrupted = false
    {
      const seen = new Set<string>()
      let lastKey: string | null = null
      for (const doc of canonical) {
        if (doc.order_key == null) continue
        if (seen.has(doc.order_key)) {
          corrupted = true
          break
        }
        if (lastKey != null && doc.order_key <= lastKey) {
          corrupted = true
          break
        }
        seen.add(doc.order_key)
        lastKey = doc.order_key
      }
    }

    if (corrupted) {
      const allKeys = generateNKeysBetween(null, null, canonical.length)
      for (let i = 0; i < canonical.length; i++) {
        await serverConfig.db.commands.documents.setOrderKey({
          document_id: canonical[i]?.id,
          order_key: allKeys[i]!,
        })
      }
    } else {
      // Happy path — backfill trailing NULLs after the largest existing
      // key. After canonical sort the NULL rows are always contiguous at
      // the tail (`NULLS LAST`).
      const firstNullIdx = canonical.findIndex((d) => d.order_key == null)
      if (firstNullIdx !== -1) {
        const nullDocs = canonical.slice(firstNullIdx)
        const lastExistingKey = firstNullIdx === 0 ? null : canonical[firstNullIdx - 1]?.order_key
        const newKeys = generateNKeysBetween(lastExistingKey, null, nullDocs.length)
        for (let i = 0; i < nullDocs.length; i++) {
          await serverConfig.db.commands.documents.setOrderKey({
            document_id: nullDocs[i]?.id,
            order_key: newKeys[i]!,
          })
        }
      }
    }

    // Keys are now clean — resolve neighbours and place the moved row.
    const { left, right } = await serverConfig.db.queries.documents.getNeighborOrderKeys({
      collection_id: collectionId,
      before_document_id: beforeDocumentId ?? null,
      after_document_id: afterDocumentId ?? null,
    })

    let newKey: string
    try {
      newKey = generateKeyBetween(left, right)
    } catch (err) {
      throw ERR_VALIDATION({
        message: 'cannot generate order_key between supplied neighbors',
        details: {
          collectionPath: path,
          documentId,
          beforeDocumentId,
          afterDocumentId,
          left,
          right,
          cause: err instanceof Error ? err.message : String(err),
        },
      }).log(logger)
    }

    await serverConfig.db.commands.documents.setOrderKey({
      document_id: documentId,
      order_key: newKey,
    })

    return { status: 'ok' as const, orderKey: newKey }
  })
