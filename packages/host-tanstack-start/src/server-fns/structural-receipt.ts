import { ErrorCodes, isDocumentRevision, type StructuralMutationReceipt } from '@byline/core'

/** Copy only the authorized receipt fields emitted by the lifecycle service. */
export function structuralReceipt(value: unknown): StructuralMutationReceipt | null {
  if (typeof value !== 'object' || value === null) return null
  const documentId = Reflect.get(value, 'documentId')
  const revision = Reflect.get(value, 'revision')
  const suspended = Reflect.get(value, 'scheduledPublicationsNeedReconfirmation')
  const affected = Reflect.get(value, 'affectedDocuments')
  if (
    typeof documentId !== 'string' ||
    !isDocumentRevision(revision) ||
    typeof suspended !== 'boolean' ||
    !Array.isArray(affected)
  )
    return null
  const affectedDocuments = []
  for (const row of affected) {
    if (typeof row !== 'object' || row === null) return null
    const id = Reflect.get(row, 'documentId')
    const token = Reflect.get(row, 'revision')
    if (typeof id !== 'string' || !isDocumentRevision(token)) return null
    affectedDocuments.push({ documentId: id, revision: token })
  }
  return {
    documentId,
    revision,
    affectedDocuments,
    scheduledPublicationsNeedReconfirmation: suspended,
  }
}

export function committedTreeReceipt(error: unknown): StructuralMutationReceipt | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    Reflect.get(error, 'code') !== ErrorCodes.TREE_HOOK_COMMITTED
  )
    return null
  return structuralReceipt(Reflect.get(error, 'details'))
}
