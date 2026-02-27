import type { DocumentPatch } from '@byline/core/patches'

import { applyPatchesFn, updateDocumentFn } from './server-fns'

export async function updateCollectionDocument(collection: string, id: string, data: any) {
  return updateDocumentFn({ data: { collection, id, data } })
}

export async function updateCollectionDocumentWithPatches(
  collection: string,
  id: string,
  data: any,
  patches: DocumentPatch[],
  document_version_id?: string,
  locale?: string
) {
  return applyPatchesFn({ data: { collection, id, patches, document_version_id, locale } })
}
