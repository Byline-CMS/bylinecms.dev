import { getCollectionSchemasForPath } from '@byline/core'

import { getDocumentHistoryFn } from './server-fns'
import type { HistorySearchParams } from './server-fns'

export type { HistorySearchParams }

export async function getCollectionDocumentHistory(
  collection: string,
  id: string,
  params: HistorySearchParams
) {
  const rawData = await getDocumentHistoryFn({ data: { collection, id, params } })

  // Validate with schema for runtime type safety.
  const { history } = getCollectionSchemasForPath(collection)
  return history.parse(rawData)
}
