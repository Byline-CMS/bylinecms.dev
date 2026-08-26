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

import {
  type DbErrorClassification,
  DbErrorCodes,
  type IDbAdapter,
  type SingletonDefinition,
} from '@byline/core'
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

  async function classifyRejection(
    operation: () => Promise<unknown>,
    expectation: string
  ): Promise<DbErrorClassification> {
    let caught: unknown
    try {
      await operation()
    } catch (error) {
      caught = error
    }

    expect(caught, expectation).toBeDefined()
    if (adapter.classifyError == null) {
      throw new Error('expected adapter to implement classifyError for this suite')
    }
    return adapter.classifyError(caught)
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

    it('locks a registered singleton slot through the ambient transaction', async () => {
      await expect(
        adapter.withTransaction(() => adapter.commands.singletons.lockSlot(collectionIds.empty))
      ).resolves.toBeUndefined()
    })

    it('rejects a singleton slot lock outside an ambient transaction', async () => {
      await expect(adapter.commands.singletons.lockSlot(collectionIds.empty)).rejects.toMatchObject(
        {
          code: 'ERR_DATABASE',
          message: 'singleton slot locks require an active transaction',
          details: { collectionId: collectionIds.empty },
        }
      )
    })

    it('rejects a missing singleton slot instead of silently taking no lock', async () => {
      await expect(
        adapter.withTransaction(() =>
          adapter.commands.singletons.lockSlot('00000000-0000-0000-0000-000000000000')
        )
      ).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' })
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

      const classification = await classifyRejection(
        () => adapter.commands.singletons.setMapping(collectionIds['same-slot'], secondDocumentId),
        'expected the singleton slot primary key to reject a second document'
      )
      expect(classification.code).toBe(DbErrorCodes.UNIQUE_VIOLATION)
      expect(classification.constraint).toMatch(/^(PRIMARY|byline_singleton_documents_pkey)$/)
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

      const classification = await classifyRejection(
        () =>
          adapter.commands.singletons.setMapping(collectionIds['same-document-target'], documentId),
        'expected the singleton document unique key to reject a second slot'
      )
      expect([
        {
          code: DbErrorCodes.UNIQUE_VIOLATION,
          constraint: 'byline_singleton_documents_document_id_unique',
        },
        {
          code: DbErrorCodes.FOREIGN_KEY_VIOLATION,
          constraint: 'fk_singleton_documents_document',
        },
      ]).toContainEqual(classification)
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['same-document-source'])
      ).resolves.toBe(documentId)
      await expect(
        adapter.queries.singletons.getMappedDocumentId(collectionIds['same-document-target'])
      ).resolves.toBeNull()
    })

    it('rejects a document owned by a different collection', async () => {
      const documentId = await createDocument('wrong-owner-source')

      const classification = await classifyRejection(
        () =>
          adapter.commands.singletons.setMapping(collectionIds['wrong-owner-target'], documentId),
        'expected the composite foreign key to reject a document from another collection'
      )
      expect(classification).toEqual({
        code: DbErrorCodes.FOREIGN_KEY_VIOLATION,
        constraint: 'fk_singleton_documents_document',
      })
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
