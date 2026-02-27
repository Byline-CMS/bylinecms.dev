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

  const { history } = getCollectionSchemasForPath(collection)

  // When locale is 'all' the storage layer returns localized fields as
  // locale-keyed objects which don't conform to the typed Zod schema — skip
  // validation in that case, same as getCollectionDocument.
  if (params.locale === 'all') {
    return rawData as ReturnType<typeof history.parse>
  }

  return history.parse(rawData)
}
