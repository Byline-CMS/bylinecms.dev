import { createDocumentFn } from './server-fns'

export async function createCollectionDocument(collection: string, data: any, locale?: string) {
  return createDocumentFn({ data: { collection, data, locale } })
}
