import { deleteDocumentFn } from './server-fns'

/**
 * Delete a document (soft-delete).
 * All versions are marked as deleted and the document disappears from listings.
 */
export async function deleteDocument(collection: string, id: string) {
  return deleteDocumentFn({ data: { collection, id } })
}
