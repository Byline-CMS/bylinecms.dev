/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Adapter-observable contract for the singleton slot → document mapping.
 *
 * The suite pins zero-or-one cardinality, document uniqueness, collection
 * ownership, cleanup semantics, and ambient transaction participation. The
 * table's ON DELETE cascade is intentionally excluded because IDbAdapter has
 * no hard-delete document command with which to drive it.
 */

import type { IDbAdapter, SingletonDefinition } from '@byline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ConformanceHooks } from '../index.js'

const timestamp = Date.now()

const slotNames = [
  'empty',
  'round-trip',
  'same-slot',
  'same-document-source',
  'same-document-target',
  'wrong-owner-source',
  'wrong-owner-target',
  'clear',
  'rollback',
] as const

type SlotName = (typeof slotNames)[number]

const definitions = Object.fromEntries(
  slotNames.map((name) => [
    name,
    {
      path: `singleton-mapping-${name}-${timestamp}`,
      label: `Singleton mapping ${name}`,
      singleton: true,
      fields: [{ name: 'title', type: 'text' }],
    } satisfies SingletonDefinition,
  ])
) as Record<SlotName, SingletonDefinition>

export function singletonMappingSuite(hooks: ConformanceHooks): void {
  let adapter: IDbAdapter
  const collectionIds = {} as Record<SlotName, string>
  let documentCounter = 0

  async function createDocument(slot: SlotName): Promise<string> {
    const definition = definitions[slot]
    const created = await adapter.commands.documents.createDocumentVersion({
      collectionId: collectionIds[slot],
      collectionVersion: 1,
      collectionConfig: definition,
      action: 'create',
      documentData: { title: `${slot} ${++documentCounter}` },
      path: `singleton-mapping-document-${timestamp}-${documentCounter}`,
      locale: 'all',
      status: 'draft',
    })
    return created.document.document_id as string
  }

  describe('singleton document mapping', () => {
    beforeAll(async () => {
      await hooks.truncate()
      adapter = await hooks.createAdapter(Object.values(definitions))

      for (const name of slotNames) {
        const created = await adapter.commands.collections.create(
          definitions[name].path,
          definitions[name]
        )
        const row = created[0]
        if (row == null) throw new Error(`Failed to register singleton mapping slot '${name}'`)
        collectionIds[name] = row.id as string
      }
    })

    afterAll(async () => {
      for (const name of slotNames) {
        const collectionId = collectionIds[name]
        if (collectionId == null) continue
        try {
          await adapter.commands.collections.delete(collectionId)
        } catch (error) {
          console.error('Failed to cleanup singleton mapping collection:', error)
        }
      }
    })

    it('returns null before a singleton has been materialised', async () => {
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds.empty)
      ).resolves.toBeNull()
    })

    it('round-trips a mapped document id', async () => {
      const documentId = await createDocument('round-trip')

      await adapter.commands.singletons.setMapping(collectionIds['round-trip'], documentId)

      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['round-trip'])
      ).resolves.toBe(documentId)
    })

    it('rejects a second document for the same singleton slot and preserves the first', async () => {
      const firstDocumentId = await createDocument('same-slot')
      const secondDocumentId = await createDocument('same-slot')
      await adapter.commands.singletons.setMapping(collectionIds['same-slot'], firstDocumentId)

      await expect(
        adapter.commands.singletons.setMapping(collectionIds['same-slot'], secondDocumentId)
      ).rejects.toBeDefined()
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['same-slot'])
      ).resolves.toBe(firstDocumentId)
    })

    it('rejects mapping the same document under a second singleton slot', async () => {
      const documentId = await createDocument('same-document-source')
      await adapter.commands.singletons.setMapping(
        collectionIds['same-document-source'],
        documentId
      )

      await expect(
        adapter.commands.singletons.setMapping(collectionIds['same-document-target'], documentId)
      ).rejects.toBeDefined()
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['same-document-source'])
      ).resolves.toBe(documentId)
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['same-document-target'])
      ).resolves.toBeNull()
    })

    it('rejects a document owned by a different collection', async () => {
      const documentId = await createDocument('wrong-owner-source')

      await expect(
        adapter.commands.singletons.setMapping(collectionIds['wrong-owner-target'], documentId)
      ).rejects.toBeDefined()
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['wrong-owner-target'])
      ).resolves.toBeNull()
    })

    it('clears the mapping without deleting the document', async () => {
      const documentId = await createDocument('clear')
      await adapter.commands.singletons.setMapping(collectionIds.clear, documentId)

      await adapter.commands.singletons.clearMapping(collectionIds.clear)

      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds.clear)
      ).resolves.toBeNull()
      await expect(
        adapter.queries.documents.getDocumentById({
          collection_id: collectionIds.clear,
          document_id: documentId,
        })
      ).resolves.not.toBeNull()
    })

    it('rolls back a mapping written inside withTransaction', async () => {
      const documentId = await createDocument('rollback')

      await expect(
        adapter.withTransaction(async () => {
          await adapter.commands.singletons.setMapping(collectionIds.rollback, documentId)
          throw new Error('rollback singleton mapping')
        })
      ).rejects.toThrow('rollback singleton mapping')
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds.rollback)
      ).resolves.toBeNull()
    })
  })
}
