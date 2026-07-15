import type { ClientDocument, CollectionHandle, TreeParentResult } from '@byline/client'
import type { ReadContext } from '@byline/core'

/** Admin tree placement reads must include drafts. */
export function getAdminTreeParent(
  handle: Pick<CollectionHandle, 'getTreeParent'>,
  documentId: string
): Promise<TreeParentResult> {
  return handle.getTreeParent(documentId, { status: 'any' })
}

/** Find unplaced nodes through the same row scope as the structural tree read. */
export async function getAdminUnplacedTreeDocuments(
  handle: Pick<CollectionHandle, 'find'>,
  placed: ReadonlySet<string>,
  readContext: ReadContext,
  locale?: string
): Promise<ClientDocument[]> {
  const all = await handle.find({
    status: 'any',
    locale,
    pageSize: 1000,
    _readContext: readContext,
  })
  return all.docs.filter((doc) => !placed.has(doc.id))
}
