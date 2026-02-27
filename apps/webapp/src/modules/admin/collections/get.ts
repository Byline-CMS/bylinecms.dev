import { getCollectionSchemasForPath } from '@byline/core'

import { getDocumentByVersionFn, getDocumentFn } from './server-fns'

export async function getCollectionDocument(collection: string, id: string, locale?: string) {
  try {
    const rawData = await getDocumentFn({ data: { collection, id, locale } })

    // Validate with schema for runtime type safety.
    const { get } = getCollectionSchemasForPath(collection)
    const document = get.parse(rawData.document)

    // Pass through published-version metadata.
    // This is null when the current version is already published.
    const publishedVersion = rawData.publishedVersion ?? null

    return { ...document, _publishedVersion: publishedVersion }
  } catch (err: any) {
    if (err?.message === 'Document not found') return null
    throw err
  }
}

export async function getCollectionDocumentVersion(
  collection: string,
  _documentId: string,
  versionId: string
) {
  try {
    const rawData = await getDocumentByVersionFn({
      data: { collection, versionId },
    })

    // Parse through the same Zod schema used by getCollectionDocument so that
    // key ordering and datetime formats are normalised identically on both sides
    // of the diff — otherwise identical content renders as changed.
    const { get } = getCollectionSchemasForPath(collection)
    return get.parse(rawData.document) as Record<string, unknown>
  } catch (err: any) {
    if (err?.message === 'Document version not found') return null
    throw err
  }
}
