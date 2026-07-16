/**
 * Maintenance helpers for `regenerate-media.ts`.
 *
 * Kept separate from the executable so the safety-critical behaviour can be
 * unit tested without loading the application server config or touching real
 * storage.
 */

import type { CollectionHandle } from '@byline/client'
import {
  getDefaultStatus,
  getWorkflowStatuses,
  type CollectionDefinition,
  type IDbAdapter,
  type StoredFileValue,
} from '@byline/core'

export function storedFilePaths(value: StoredFileValue): Set<string> {
  return new Set([
    value.storagePath,
    ...(value.variants ?? [])
      .map((variant) => variant.storagePath)
      .filter((storagePath): storagePath is string => Boolean(storagePath)),
  ])
}

/**
 * Reject a partial image-processor result before it replaces a complete
 * persisted value. Core uploads deliberately tolerate an individual variant
 * failure for interactive requests; this maintenance operation must be
 * stricter because it is about bringing every stored asset up to the schema.
 */
export function assertCompleteVariantSet(
  storedFile: StoredFileValue,
  expectedVariantNames: readonly string[]
): void {
  const expected = [...expectedVariantNames].sort()
  const actual = (storedFile.variants ?? []).map((variant) => variant.name).sort()
  if (
    expected.length !== actual.length ||
    expected.some((variantName, index) => variantName !== actual[index])
  ) {
    throw new Error(
      `regenerate-media: incomplete variant set for '${storedFile.storagePath}' ` +
        `(expected: ${expected.join(', ') || 'none'}; generated: ${actual.join(', ') || 'none'}).`
    )
  }
}

/**
 * Write the regenerated fields and restore the captured workflow status as
 * one transaction.
 *
 * `CollectionHandle.update()` creates a new immutable version at the
 * collection's default status. For this maintenance operation, changing that
 * newly-created row to the captured status inside the same transaction is not
 * an editorial transition: no caller can observe the intermediate draft, and
 * an archived item never passes through published. The final version row and
 * its normal `document.updated` activity entry retain the resulting status;
 * the explicit status mutation is additionally audited as a system action.
 *
 * Direct adapter commands are intentional here and should not be copied into
 * ordinary application writes. Scripts are the supported escape hatch for
 * migrations that must preserve metadata while still using the lifecycle for
 * the content update itself.
 */
export async function replaceMediaVersionPreservingStatus(params: {
  db: IDbAdapter
  definition: CollectionDefinition
  collectionId: string
  handle: Pick<CollectionHandle, 'update'>
  documentId: string
  fields: Record<string, any>
  targetStatus: string
}): Promise<{ documentVersionId: string }> {
  const statuses = getWorkflowStatuses(params.definition).map((status) => status.name)
  if (!statuses.includes(params.targetStatus)) {
    throw new Error(
      `regenerate-media: status '${params.targetStatus}' is not declared on collection ` +
        `'${params.definition.path}' (declared: ${statuses.join(', ')}).`
    )
  }

  const defaultStatus = getDefaultStatus(params.definition)
  return params.db.withTransaction(async () => {
    const result = await params.handle.update(params.documentId, params.fields)
    if (params.targetStatus === defaultStatus) return result

    await params.db.commands.documents.setDocumentStatus({
      document_version_id: result.documentVersionId,
      status: params.targetStatus,
    })
    if (params.targetStatus === 'published') {
      await params.db.commands.documents.archivePublishedVersions({
        document_id: params.documentId,
        excludeVersionId: result.documentVersionId,
      })
    }
    await params.db.commands.audit.append({
      documentId: params.documentId,
      collectionId: params.collectionId,
      actorId: null,
      actorRealm: 'system',
      action: 'document.status.changed',
      field: 'status',
      before: defaultStatus,
      after: params.targetStatus,
    })

    return result
  })
}
