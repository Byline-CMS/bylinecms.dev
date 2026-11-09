/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createSuperAdminContext } from '@byline/auth'
import type { ArrayField, BylineLogger, IDbAdapter, MultiCollectionDefinition } from '@byline/core'
import { type DocumentLifecycleContext, updateDocument } from '@byline/core/services'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ConformanceHooks } from '../index.js'

export function localizedToggleSuite(hooks: ConformanceHooks) {
  describe('Localized toggle', () => {
    const caption = { name: 'caption', type: 'text' as const, localized: true }
    const items: ArrayField = { name: 'items', type: 'array', fields: [caption] }
    const definition: MultiCollectionDefinition = {
      path: 'localized-toggle',
      labels: { singular: 'Toggle', plural: 'Toggles' },
      fields: [items],
    }
    const logger = Object.fromEntries(
      ['log', 'fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].map((key) => [
        key,
        vi.fn(),
      ])
    ) as unknown as BylineLogger
    let adapter: IDbAdapter
    let collectionId: string
    const context = (): DocumentLifecycleContext => ({
      db: adapter,
      definition,
      collectionPath: definition.path,
      collectionId,
      collectionVersion: 1,
      defaultLocale: 'en',
      logger,
      requestContext: createSuperAdminContext(),
    })
    const read = (id: string, locale: string, lenient = false) =>
      adapter.queries.documents.getDocumentById({
        collection_id: collectionId,
        document_id: id,
        locale,
        reconstruct: true,
        lenient,
        localeVisibility: 'public',
      })
    const revision = (id: string) =>
      adapter.queries.documents.getDocumentRevision({
        collection_id: collectionId,
        document_id: id,
      })

    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter([definition])
      collectionId = (await adapter.commands.collections.create(definition.path, definition))[0]!.id
    })

    // Pre-existing bug (not caused by the localized toggle): a single-locale save that
    // removes an array item carries the other locales' rows forward by position, so the
    // removed item's fr translation ('A-fr') attaches to the surviving item B.
    // Issue: pending (to be filed by the maintainer)
    it.fails('positional copy-forward misattributes translations after an item removal (pre-existing)', async () => {
      const saved = await adapter.commands.documents.createDocumentVersion({
        collectionId,
        collectionVersion: 1,
        collectionConfig: definition,
        action: 'create',
        documentData: {
          items: [{ caption: { en: 'A', fr: 'A-fr' } }, { caption: { en: 'B', fr: 'B-fr' } }],
        },
        locale: 'all',
        status: 'published',
      })
      const id = saved.document.document_id
      const before = await read(id, 'en')
      const itemB = before.fields.items[1]
      await updateDocument(context(), {
        documentId: id,
        expectedRevision: (await revision(id))!,
        locale: 'en',
        data: { items: [itemB] },
      })
      const after = await read(id, 'all', true)
      expect(after.fields.items).toHaveLength(1)
      expect(after.fields.items[0].caption).toEqual({ en: 'B', fr: 'B-fr' })
    })
  })
}
