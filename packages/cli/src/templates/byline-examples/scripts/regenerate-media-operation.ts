/**
 * Maintenance helpers for `regenerate-media.ts`.
 *
 * Kept separate from the executable so the safety-critical behaviour can be
 * unit tested without loading the application server config or touching real
 * storage.
 */

import type { StoredFileValue } from '@byline/core'
import { getDocumentHookCommittedDetails } from '@byline/core/services'

export { replaceDocumentFieldsPreservingStatus as replaceMediaVersionPreservingStatus } from '@byline/core/services'

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

/** Only rejected document writes may discard freshly prepared storage objects. */
export function mediaFailureOutcome(
  error: unknown,
  freshPaths: ReadonlySet<string>,
  oldPaths: ReadonlySet<string>
):
  | { committed: true; revision: number; cleanupPaths: Set<string> }
  | { committed: false; cleanupPaths: Set<string> } {
  const committed = getDocumentHookCommittedDetails(error)
  if (committed) return { committed: true, revision: committed.revision, cleanupPaths: new Set() }
  return {
    committed: false,
    cleanupPaths: new Set([...freshPaths].filter((path) => !oldPaths.has(path))),
  }
}
