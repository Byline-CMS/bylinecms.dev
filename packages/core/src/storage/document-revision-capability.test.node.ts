import { describe, expect, it, vi } from 'vitest'

import { assertDocumentRevisionCapability } from './document-revision-capability.js'
import type { IDbAdapter } from '../@types/db-types.js'

describe('document revision adapter capability', () => {
  const adapter = () =>
    ({
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
    }) as unknown as IDbAdapter
  for (const missing of [
    'assertCompatibleSchema',
    'isInTransaction',
    'lock',
    'advance',
    'readStructure',
  ]) {
    it(`rejects JavaScript adapters missing ${missing}`, async () => {
      const db = adapter()
      delete (db.revisions as unknown as Record<string, unknown>)[missing]
      await expect(assertDocumentRevisionCapability(db)).rejects.toMatchObject({
        code: 'ERR_DATABASE',
        message: expect.stringContaining('Upgrade the adapter'),
      })
    })
  }
  it('rejects JavaScript adapters without coherent read snapshots before schema work', async () => {
    const db = adapter()
    delete (db as unknown as Record<string, unknown>).withReadSnapshot
    await expect(assertDocumentRevisionCapability(db)).rejects.toMatchObject({
      code: 'ERR_DATABASE',
    })
    expect(db.revisions.assertCompatibleSchema).not.toHaveBeenCalled()
  })
  it('rejects old adapters with no revision surface', async () => {
    await expect(
      assertDocumentRevisionCapability({ withTransaction: vi.fn() } as unknown as IDbAdapter)
    ).rejects.toMatchObject({ code: 'ERR_DATABASE' })
  })
  it('awaits schema validation and preserves the actionable upgrade error', async () => {
    const db = adapter()
    const error = new Error('fence and upgrade schema')
    vi.mocked(db.revisions.assertCompatibleSchema).mockRejectedValue(error)
    await expect(assertDocumentRevisionCapability(db)).rejects.toBe(error)
  })
})
