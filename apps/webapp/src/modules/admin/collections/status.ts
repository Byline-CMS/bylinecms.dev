import { changeStatusFn, unpublishDocumentFn } from './server-fns'

export async function updateDocumentStatus(collection: string, id: string, status: string) {
  return changeStatusFn({ data: { collection, id, status } })
}

/**
 * Unpublish a document by archiving its published version.
 * This is a cross-version action — it sets a *previous* published version
 * to 'archived', not a workflow transition on the current version.
 */
export async function unpublishDocument(collection: string, id: string) {
  return unpublishDocumentFn({ data: { collection, id } })
}
