import type { CollectionHandle } from '@byline/client'

/** Preserve the revision returned by each successful workflow transition.
 * A conflict terminates the walk; it never fetches a newer observation. */
export async function walkToStatus(
  handle: Pick<CollectionHandle, 'changeStatus'>,
  documentId: string,
  workflowStatuses: readonly { name: string }[],
  currentStatus: string,
  targetStatus: string,
  expectedRevision: number
): Promise<number> {
  const currentIdx = workflowStatuses.findIndex((s) => s.name === currentStatus)
  const targetIdx = workflowStatuses.findIndex((s) => s.name === targetStatus)
  if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return expectedRevision
  for (let i = currentIdx + 1; i <= targetIdx; i++) {
    const result = await handle.changeStatus(documentId, workflowStatuses[i].name, { expectedRevision })
    expectedRevision = result.revision
  }
  return expectedRevision
}
