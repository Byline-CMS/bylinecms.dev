import { getCollectionSchemasForPath } from '@byline/core'

import { getDocumentByVersionFn, getDocumentFn } from './server-fns'

export async function getCollectionDocument(collection: string, id: string, locale?: string) {
  try {
    const rawData = await getDocumentFn({ data: { collection, id, locale } })

    // When fetching all locales the storage layer returns localized fields as
    // locale-keyed objects (e.g. { en: '...', fr: '...' }) which do not
    // conform to the typed per-locale Zod schema — skip validation in that case.
    const document =
      locale === 'all'
        ? (rawData.document as Record<string, unknown>)
        : (() => {
            const { get } = getCollectionSchemasForPath(collection)
            return get.parse(rawData.document)
          })()

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
  versionId: string,
  locale?: string
) {
  try {
    const resolvedLocale = locale ?? 'all'
    const rawData = await getDocumentByVersionFn({
      data: { collection, versionId, locale: resolvedLocale },
    })

    // When fetching all locales the storage layer returns localized fields as
    // locale-keyed objects — skip Zod validation in that case (same as
    // getCollectionDocument). For a specific locale, parse for runtime safety.
    if (resolvedLocale === 'all') {
      return rawData.document as Record<string, unknown>
    }

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
