import type { CollectionHandle, PlaceTreeNodeOptions, RemoveFromTreeOptions } from '@byline/client'

/** Admin retries reconcile post-commit tree hooks unless explicitly disabled. */
export function placeAdminTreeNode(
  handle: Pick<CollectionHandle, 'placeTreeNode'>,
  documentId: string,
  options: PlaceTreeNodeOptions
): Promise<{ orderKey: string }> {
  return handle.placeTreeNode(documentId, {
    ...options,
    reconcile: options.reconcile ?? true,
  })
}

/** Admin retries reconcile post-commit tree hooks unless explicitly disabled. */
export function removeAdminTreeNode(
  handle: Pick<CollectionHandle, 'removeFromTree'>,
  documentId: string,
  options: RemoveFromTreeOptions = {}
): Promise<void> {
  return handle.removeFromTree(documentId, {
    ...options,
    reconcile: options.reconcile ?? true,
  })
}
