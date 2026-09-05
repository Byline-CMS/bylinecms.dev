import type { DocumentRevisionStore } from '../@types/document-revision.js'

/** Unrelated unit fixtures must fail if they accidentally exercise revision storage. */
export const unusedRevisionStore: DocumentRevisionStore = {
  readStructure: async () => {
    throw new Error('Structural storage is outside this unit fixture.')
  },
  assertCompatibleSchema: async () => {
    throw new Error('Revision storage is outside this unit fixture.')
  },
  isInTransaction: () => false,
  lock: async () => {
    throw new Error('Revision storage is outside this unit fixture.')
  },
  advance: async () => {
    throw new Error('Revision storage is outside this unit fixture.')
  },
}
