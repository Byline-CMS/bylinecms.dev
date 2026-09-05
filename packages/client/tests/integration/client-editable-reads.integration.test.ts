import { createRequestContext } from '@byline/auth'
import { defineCollection, defineSingleton } from '@byline/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createBylineClient } from '../../src/index.js'
import { observedRevision } from '../fixtures/observed-revision.js'
import { setupMultiCollectionTestClient } from '../fixtures/setup.js'

let hide = false
let redact = false
let tamper = false
let hookSnapshotStates: boolean[] = []
let snapshotActive = false
const beforeRead = vi.fn(() => (hide ? (false as const) : undefined))
const afterRead = vi.fn(({ doc }: { doc: Record<string, any> }) => {
  hookSnapshotStates.push(snapshotActive)
  if (redact) {
    delete doc.fields.secret
    delete doc.availableLocales
    doc.path = null
  }
  if (tamper) {
    doc.document_id = 'forged'
    doc.document_version_id = 'forged'
    doc.revision = 999
    doc.status = 'published'
  }
})
const definition = defineCollection({
  path: 'editable-client',
  labels: { singular: 'Edit', plural: 'Edits' },
  tree: true,
  fields: [
    { name: 'title', type: 'text' },
    { name: 'secret', type: 'text', optional: true },
  ],
  hooks: { beforeRead, afterRead },
})
const singleton = defineSingleton({
  path: 'editable-slot',
  label: 'Editable slot',
  fields: [{ name: 'title', type: 'text' }],
  hooks: { beforeRead },
})
let setup: Awaited<ReturnType<typeof setupMultiCollectionTestClient>>
let id: string
let versionId: string
beforeAll(async () => {
  setup = await setupMultiCollectionTestClient([definition, singleton])
  const created = await setup.client
    .collection(definition.path)
    .create({ title: 'Original', secret: 'private' })
  id = created.documentId
  versionId = created.documentVersionId
  const original = setup.db.withReadSnapshot.bind(setup.db)
  vi.spyOn(setup.db, 'withReadSnapshot').mockImplementation((fn) =>
    original(async (queries) => {
      snapshotActive = true
      try {
        return await fn(queries)
      } finally {
        snapshotActive = false
      }
    })
  )
})

describe('explicit editable client reads', () => {
  it('captures source metadata and revision, runs hooks once outside the snapshot, and preserves field redaction', async () => {
    redact = true
    tamper = true
    hookSnapshotStates = []
    beforeRead.mockClear()
    afterRead.mockClear()
    try {
      const doc = await setup.client.collection(definition.path).findByIdForEdit(id)
      expect(doc).toMatchObject({
        id,
        versionId,
        revision: 1,
        status: 'draft',
        fields: { title: 'Original' },
        scheduledPublication: null,
      })
      expect(doc?.fields).not.toHaveProperty('secret')
      expect(doc).not.toHaveProperty('availableLocales')
      expect(doc?.path).toBe('')
      expect(beforeRead).toHaveBeenCalledTimes(1)
      expect(afterRead).toHaveBeenCalledTimes(1)
      expect(hookSnapshotStates).toEqual([false])
    } finally {
      redact = false
      tamper = false
    }
  })

  it('returns only selected fields on action-bearing list rows', async () => {
    const result = await setup.client.collection(definition.path).findForEdit({ select: ['title'] })
    expect(result.docs).toHaveLength(1)
    expect(result.docs[0]).toMatchObject({ id, revision: 1, fields: { title: 'Original' } })
    expect(result.docs[0]?.fields).not.toHaveProperty('secret')
  })

  it('keeps public and historical reads token-free without snapshot or revision queries', async () => {
    await setup.client
      .collection(definition.path)
      .changeStatus(id, 'published', { expectedRevision: 1 })
    const snapshots = vi.mocked(setup.db.withReadSnapshot)
    snapshots.mockClear()
    const revisionRead = vi.spyOn(setup.db.queries.documents, 'getDocumentRevision')
    const scheduleRead = vi.spyOn(setup.db.queries.documents.publishSchedules, 'get')
    const handle = setup.client.collection(definition.path)
    for (const doc of [
      await handle.findById(id),
      await handle.findByVersion(versionId),
      ...(await handle.find()).docs,
    ]) {
      expect(doc).not.toHaveProperty('revision')
      expect(doc).not.toHaveProperty('scheduledPublication')
    }
    expect(snapshots).not.toHaveBeenCalled()
    expect(revisionRead).not.toHaveBeenCalled()
    expect(scheduleRead).not.toHaveBeenCalled()
  })

  it('rejects historical/published selectors supplied by JavaScript callers', async () => {
    const handle = setup.client.collection(definition.path)
    await expect(handle.findByIdForEdit(id, { status: 'published' } as any)).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
    await expect(handle.findForEdit({ versionId } as any)).rejects.toMatchObject({
      code: 'ERR_VALIDATION',
    })
  })

  it('applies beforeRead scoping to document, list and tree observations', async () => {
    hide = true
    try {
      const handle = setup.client.collection(definition.path)
      expect(await handle.findByIdForEdit(id)).toBeNull()
      expect((await handle.findForEdit()).docs).toEqual([])
      expect(await handle.getTreeForEdit()).toEqual({ forest: [], unplaced: [] })
    } finally {
      hide = false
    }
  })

  it('returns no editable payload and does not replay hooks when a snapshot fails', async () => {
    beforeRead.mockClear()
    afterRead.mockClear()
    vi.mocked(setup.db.withReadSnapshot).mockRejectedValueOnce(new Error('snapshot failed'))
    await expect(setup.client.collection(definition.path).findByIdForEdit(id)).rejects.toThrow(
      'snapshot failed'
    )
    expect(beforeRead).toHaveBeenCalledTimes(1)
    expect(afterRead).not.toHaveBeenCalled()
  })

  it('does not grant public callers an any-mode editable read', async () => {
    const client = createBylineClient({
      db: setup.db,
      collections: [definition, singleton],
      requestContext: createRequestContext({ readMode: 'published' }),
    })
    await expect(client.collection(definition.path).findByIdForEdit(id)).rejects.toBeDefined()
    await expect(client.singleton(singleton.path).getForEdit()).rejects.toBeDefined()
  })

  it('distinguishes an empty singleton from a hidden mapped document', async () => {
    const handle = setup.client.singleton(singleton.path)
    expect(await handle.getForEdit()).toEqual({ state: 'empty' })
    await handle.update({ title: 'Settings' }, { expectedState: 'empty' })
    expect(await handle.getForEdit()).toMatchObject({
      state: 'document',
      document: { revision: 1, fields: { title: 'Settings' } },
    })
    hide = true
    try {
      expect(await handle.getForEdit()).toBeNull()
    } finally {
      hide = false
    }
  })

  it('returns coherent revisions for placed and unplaced tree action rows', async () => {
    const handle = setup.client.collection(definition.path)
    await handle.placeTreeNode(id, {
      expectedRevision: await observedRevision(handle, id),
      parentDocumentId: null,
    })
    const other = await handle.create({ title: 'Unplaced' })
    await handle.removeFromTree(other.documentId, { expectedRevision: other.revision })
    const tree = await handle.getTreeForEdit()
    expect(tree.forest[0]?.document).toMatchObject({ id, revision: 2 })
    expect(tree.unplaced).toEqual([expect.objectContaining({ id: other.documentId, revision: 2 })])
    expect((await handle.getSubtreeForEdit())[0]?.document.id).toBe(id)
  })
})
