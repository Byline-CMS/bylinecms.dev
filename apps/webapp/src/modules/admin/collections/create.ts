import { createDocumentFn } from './server-fns'

export async function createCollectionDocument(collection: string, data: any) {
  return createDocumentFn({ data: { collection, data } })
}
