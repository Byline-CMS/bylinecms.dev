import { describe, expect, it, vi } from 'vitest'

import { testAdapter } from './db-adapter.test-helper.js'
import { assertDocumentRevisionCapability } from './document-revision-capability.js'

describe('document revision adapter capability', () => {
  const adapter = () =>
    testAdapter({
      commands: {
        collections: { lockCollectionRegistration: vi.fn() },
        documents: { publishSchedules: { lockDocuments: vi.fn() } },
      },
      withTransaction: vi.fn(),
      withReadSnapshot: vi.fn(),
      revisions: {
        assertCompatibleSchema: vi.fn(async () => {}),
        isInTransaction: () => false,
        lock: vi.fn(),
        readStructure: vi.fn(),
        advance: vi.fn(),
      },
    })
  for (const missing of [
    'assertCompatibleSchema',
    'isInTransaction',
    'lock',
    'advance',
    'readStructure',
  ]) {
    it(`rejects JavaScript adapters missing ${missing}`, async () => {
      const db = adapter()
      Reflect.deleteProperty(db.revisions, missing)
      await expect(assertDocumentRevisionCapability(db)).rejects.toMatchObject({
        code: 'ERR_DATABASE',
        message: expect.stringContaining('Upgrade the adapter'),
      })
    })
  }
  it('rejects JavaScript adapters without coherent read snapshots before schema work', async () => {
    const db = adapter()
    Reflect.deleteProperty(db, 'withReadSnapshot')
    await expect(assertDocumentRevisionCapability(db)).rejects.toMatchObject({
      code: 'ERR_DATABASE',
    })
    expect(db.revisions.assertCompatibleSchema).not.toHaveBeenCalled()
  })
  it('rejects old adapters with no revision surface', async () => {
    await expect(
      Reflect.apply(assertDocumentRevisionCapability, undefined, [{ withTransaction: vi.fn() }])
    ).rejects.toMatchObject({ code: 'ERR_DATABASE' })
  })
  it('awaits schema validation and preserves the actionable upgrade error', async () => {
    const db = adapter()
    const error = new Error('fence and upgrade schema')
    vi.mocked(db.revisions.assertCompatibleSchema).mockRejectedValue(error)
    await expect(assertDocumentRevisionCapability(db)).rejects.toBe(error)
  })
})
