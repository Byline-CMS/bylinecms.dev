import type { ClientDocument, CollectionHandle, TreeParentResult } from '@byline/client'

/** Admin tree placement reads must include drafts. */
export function getAdminTreeParent(
  handle: Pick<CollectionHandle, 'getTreeParent'>,
  documentId: string
): Promise<TreeParentResult> {
  return handle.getTreeParent(documentId, { status: 'any' })
}

/** Find unplaced nodes through a normal scoped admin read. */
export async function getAdminUnplacedTreeDocuments(
  handle: Pick<CollectionHandle, 'find'>,
  placed: ReadonlySet<string>,
  locale?: string
): Promise<ClientDocument[]> {
  const all = await handle.find({
    status: 'any',
    locale,
    pageSize: 1000,
  })
  return all.docs.filter((doc) => !placed.has(doc.id))
}
