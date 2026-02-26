import { getCollectionSchemasForPath } from '@byline/core'

import { listDocumentsFn } from './server-fns'
import type { CollectionSearchParams } from './server-fns'

export type { CollectionSearchParams }

export async function getCollectionDocuments(collection: string, params: CollectionSearchParams) {
  const rawData = await listDocumentsFn({ data: { collection, params } })

  // Validate with schema for runtime type safety and field normalisation.
  const { list } = getCollectionSchemasForPath(collection)
  return list.parse(rawData)
}
