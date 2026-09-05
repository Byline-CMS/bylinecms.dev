import { parseDocumentRevision } from '@byline/core'

/** A new test-fixture observation for a subsequent, independent editorial action. */
export async function observedRevision(
  handle: {
    findByIdForEdit(id: string): Promise<{ revision: number } | null>
  },
  documentId: string
): Promise<number> {
  const document = await handle.findByIdForEdit(documentId)
  if (typeof document !== 'object' || document === null)
    throw new Error('Missing editable fixture document')
  return parseDocumentRevision(Reflect.get(document, 'revision'))
}
