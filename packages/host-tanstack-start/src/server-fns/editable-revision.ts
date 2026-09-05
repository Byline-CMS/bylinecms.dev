import { ERR_DATABASE, isDocumentRevision } from '@byline/core'

/** Restore metadata stripped by schema parsing only onto the exact source version.
 * Never attach by array position: filtering/reordering must not transfer tokens. */
export function withEditableRevision<T extends object>(
  document: T,
  observation: { id: string; versionId: string; revision: number } | undefined
): T & { revision: number } {
  if (
    !observation ||
    !isDocumentRevision(observation.revision) ||
    Reflect.get(document, 'id') !== observation.id ||
    Reflect.get(document, 'versionId') !== observation.versionId
  ) {
    throw ERR_DATABASE({ message: 'Editable response no longer matches its source observation' })
  }
  return { ...document, revision: observation.revision }
}
