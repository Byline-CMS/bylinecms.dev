/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Integration test for the "make current" / restore-version flow.
 *
 * Validates that the Postgres locale='all' round-trip
 * (`getDocumentByVersion` → `createDocumentVersion`) preserves multi-locale
 * content and stable block `_id`s — the core invariant
 * `restoreDocumentVersion` in @byline/core depends on. Pure storage-layer:
 * the lifecycle wrapper, auth, and hooks are covered by unit tests in
 * `packages/core/src/services/document-lifecycle.test.node.ts`.
 */

import type { CollectionDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDB, teardownTestDB } from '../../../lib/test-helper.js'

let commandBuilders: ReturnType<typeof import('../storage-commands.js').createCommandBuilders>
let queryBuilders: ReturnType<typeof import('../storage-queries.js').createQueryBuilders>

const timestamp = Date.now()

const RestoreCollectionConfig: CollectionDefinition = {
  path: `restore-${timestamp}`,
  labels: { singular: 'Restorable', plural: 'Restorables' },
  fields: [
    { name: 'sku', type: 'text' },
    { name: 'title', type: 'text', localized: true },
    {
      name: 'sections',
      type: 'array',
      fields: [
        {
          name: 'sectionItem',
          type: 'array',
          fields: [
            { name: 'heading', type: 'text', localized: true },
            { name: 'body', type: 'text', localized: true },
          ],
        },
      ],
    },
  ],
}

let testCollection: { id: string } = {} as any

describe('Document version restore — storage round-trip', () => {
  beforeAll(async () => {
    const testDB = setupTestDB([RestoreCollectionConfig])
    commandBuilders = testDB.commandBuilders
    queryBuilders = testDB.queryBuilders

    const result = await commandBuilders.collections.create(
      RestoreCollectionConfig.path,
      RestoreCollectionConfig
    )
    const collection = result[0]
    if (collection == null) throw new Error('Failed to create test collection')
    testCollection = { id: collection.id }
  })

  afterAll(async () => {
    try {
      await commandBuilders.collections.delete(testCollection.id)
    } catch (err) {
      console.error('Failed to cleanup test collection:', err)
    }
    await teardownTestDB()
  })

  it('round-trips multi-locale fields and preserves block _ids when re-emitted via locale: "all"', async () => {
    const v1Data = {
      sku: `RESTORE-${timestamp}`,
      title: { en: 'V1 EN', fr: 'V1 FR' },
      sections: [
        {
          sectionItem: [
            { heading: { en: 'Intro EN', fr: 'Intro FR' }, body: { en: 'A', fr: 'A-fr' } },
            { heading: { en: 'Body EN', fr: 'Body FR' }, body: { en: 'B', fr: 'B-fr' } },
          ],
        },
      ],
    }

    const v1 = await commandBuilders.documents.createDocumentVersion({
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: RestoreCollectionConfig,
      action: 'create',
      documentData: v1Data,
      path: v1Data.sku,
      locale: 'all',
      status: 'draft',
    })
    const documentId = v1.document.document_id
    const v1Id = v1.document.id

    // v1 reconstruct — captures the assigned _ids
    const v1Read = await queryBuilders.documents.getDocumentByVersion({
      document_version_id: v1Id,
      locale: 'all',
    })
    const v1Sections = (v1Read as any).fields.sections as any[]
    const v1ItemIds = (v1Sections[0].sectionItem as any[]).map((item) => item._id)
    expect(
      v1ItemIds.every((id: unknown) => typeof id === 'string' && (id as string).length > 0),
      'v1 items should have stable _ids'
    ).toBeTruthy()

    // Mutate to v2 (different content)
    const v2Data = {
      sku: v1Data.sku,
      title: { en: 'V2 EN', fr: 'V2 FR' },
      sections: [
        {
          sectionItem: [
            { heading: { en: 'Replaced EN', fr: 'Replaced FR' }, body: { en: 'X', fr: 'X-fr' } },
          ],
        },
      ],
    }
    await commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: RestoreCollectionConfig,
      action: 'update',
      documentData: v2Data,
      path: v1Data.sku,
      locale: 'all',
      status: 'draft',
    })

    // Restore: read v1 with locale='all' and re-emit verbatim with locale='all'.
    // This is what `restoreDocumentVersion` in @byline/core does.
    const sourceFields = (v1Read as any).fields
    const v3 = await commandBuilders.documents.createDocumentVersion({
      documentId,
      collectionId: testCollection.id,
      collectionVersion: 1,
      collectionConfig: RestoreCollectionConfig,
      action: 'restore',
      documentData: sourceFields,
      path: v1Data.sku,
      locale: 'all',
      status: 'draft',
    })

    expect((v3.document as any).event_type, 'event_type should be persisted as "restore"').toBe(
      'restore'
    )

    // Reconstruct v3. Multi-locale fields, block _ids, and per-item content
    // should match v1 — not v2.
    const v3Read = await queryBuilders.documents.getDocumentByVersion({
      document_version_id: v3.document.id,
      locale: 'all',
    })
    const v3Fields = (v3Read as any).fields

    expect(v3Fields.title, 'restored title should match v1 across all locales').toEqual(
      v1Data.title
    )

    const v3Sections = v3Fields.sections as any[]
    const v3ItemIds = (v3Sections[0].sectionItem as any[]).map((item: any) => item._id)
    expect(
      v3ItemIds,
      'restored block items should keep the v1 _ids verbatim (identity preserved across restore)'
    ).toEqual(v1ItemIds)

    expect(
      v3Sections[0].sectionItem.length,
      "restored version should have v1's two items, not v2's single item"
    ).toBe(2)
    expect(v3Sections[0].sectionItem[0].heading).toEqual({
      en: 'Intro EN',
      fr: 'Intro FR',
    })
    expect(v3Sections[0].sectionItem[1].heading).toEqual({
      en: 'Body EN',
      fr: 'Body FR',
    })
  })
})
