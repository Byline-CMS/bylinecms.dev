import { getCollectionSchemasForPath } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'

export interface CollectionSearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
  status?: string
}

export interface HistorySearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  locale?: string
}

// API base URL is now same-origin (served by TanStack Start server routes).
const API_BASE_URL = '/admin/api'

export async function getCollectionDocuments(collection: string, params: CollectionSearchParams) {
  const searchParams = new URLSearchParams()

  if (params.page != null) searchParams.set('page', params.page.toString())
  if (params.page_size != null) searchParams.set('page_size', params.page_size.toString())
  if (params.order != null) searchParams.set('order', params.order)
  if (params.desc != null) searchParams.set('desc', params.desc.toString())
  if (params.query != null) searchParams.set('query', params.query)
  if (params.locale != null) searchParams.set('locale', params.locale)
  if (params.status != null) searchParams.set('status', params.status)

  const queryString = searchParams.toString()
  const url = `${API_BASE_URL}/${collection}${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch collection')
  }

  const rawData = await response.json()

  // Validate with schema for runtime type safety
  const { list } = getCollectionSchemasForPath(collection)
  return list.parse(rawData)
}

export async function getCollectionDocument(collection: string, id: string) {
  const url = `${API_BASE_URL}/${collection}/${id}`

  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    throw new Error('Failed to fetch record')
  }

  const rawData = await response.json()

  // Validate with schema for runtime type safety
  const { get } = getCollectionSchemasForPath(collection)
  const document = get.parse(rawData.document)

  // Pass through published-version metadata returned by the API.
  // This is null when the current version is already published.
  const publishedVersion = rawData.publishedVersion ?? null

  return { ...document, _publishedVersion: publishedVersion }
}

export async function getCollectionDocumentHistory(
  collection: string,
  id: string,
  params: HistorySearchParams
) {
  const searchParams = new URLSearchParams()

  if (params.page != null) searchParams.set('page', params.page.toString())
  if (params.page_size != null) searchParams.set('page_size', params.page_size.toString())
  if (params.order != null) searchParams.set('order', params.order)
  if (params.desc != null) searchParams.set('desc', params.desc.toString())
  if (params.locale != null) searchParams.set('locale', params.locale)

  const queryString = searchParams.toString()
  const url = `${API_BASE_URL}/${collection}/${id}/history${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to fetch history')
  }

  const rawData = await response.json()

  // Validate with schema for runtime type safety
  const { history } = getCollectionSchemasForPath(collection)
  return history.parse(rawData)
}

export async function getCollectionDocumentVersion(
  collection: string,
  documentId: string,
  versionId: string
) {
  const url = `${API_BASE_URL}/${collection}/${documentId}?version_id=${encodeURIComponent(versionId)}`

  const response = await fetch(url)
  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    throw new Error('Failed to fetch document version')
  }

  const rawData = await response.json()

  // Parse through the same Zod schema used by getCollectionDocument so that
  // key ordering and datetime formats are normalised identically on both sides
  // of the diff — otherwise identical content renders as changed.
  const { get } = getCollectionSchemasForPath(collection)
  return get.parse(rawData.document) as Record<string, unknown>
}

export async function createCollectionDocument(collection: string, data: any) {
  const url = `${API_BASE_URL}/${collection}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create document')
  }
  return response.json()
}

export async function updateCollectionDocument(collection: string, id: string, data: any) {
  const url = `${API_BASE_URL}/${collection}/${id}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update document')
  }
  return response.json()
}

export async function updateCollectionDocumentWithPatches(
  collection: string,
  id: string,
  data: any,
  patches: DocumentPatch[],
  document_version_id?: string
) {
  const url = `${API_BASE_URL}/${collection}/${id}/patches`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, patches, document_version_id }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update document with patches')
  }
  return response.json()
}

export async function updateDocumentStatus(collection: string, id: string, status: string) {
  const url = `${API_BASE_URL}/${collection}/${id}/status`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || error.reason || 'Failed to update document status')
  }
  return response.json()
}

/**
 * Unpublish a document by archiving its published version.
 * This is a cross-version action — it sets a *previous* published version
 * to 'archived', not a workflow transition on the current version.
 */
export async function unpublishDocument(collection: string, id: string) {
  const url = `${API_BASE_URL}/${collection}/${id}/unpublish`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to unpublish document')
  }
  return response.json()
}

/**
 * Delete a document (soft-delete).
 * All versions are marked as deleted and the document disappears from listings.
 */
export async function deleteDocument(collection: string, id: string) {
  const url = `${API_BASE_URL}/${collection}/${id}`
  const response = await fetch(url, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete document')
  }
  return response.json()
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadDocumentResult {
  /** Present when the upload endpoint created a document (createDocument=true, the default). */
  documentId?: string
  documentVersionId?: string
  storedFile: {
    file_id: string
    filename: string
    original_filename: string
    mime_type: string
    file_size: string
    storage_provider: string
    storage_path: string
    storage_url: string
    file_hash: string | null
    image_width: number | null
    image_height: number | null
    image_format: string | null
    processing_status: 'complete' | 'pending' | 'failed'
    thumbnail_generated: boolean
  }
  variants: Array<{ name: string; url: string }>
}

/**
 * Upload a file to an upload-enabled collection.
 *
 * The server stores the file, extracts image metadata, generates variants,
 * and creates a document version in one atomic request.
 *
 * @param collection      - collection path (e.g. `'media'`)
 * @param formData        - FormData with at minimum a `file` (File) field; may
 *                          also include `title`, `altText`, `caption`, `credit`,
 *                          `category`.
 * @param createDocument  - when `false`, the server stores the file and returns
 *                          the StoredFileValue but does NOT create a document
 *                          version. Use this when the upload is part of an
 *                          in-form field widget — the form's own save will
 *                          create the document. Defaults to `true`.
 */
export async function uploadDocument(
  collection: string,
  formData: FormData,
  createDocument = true
): Promise<UploadDocumentResult> {
  const base = `${API_BASE_URL}/${collection}/upload`
  const url = createDocument ? base : `${base}?createDocument=false`
  const response = await fetch(url, {
    method: 'POST',
    // Do NOT set Content-Type manually — the browser must set the multipart
    // boundary automatically when body is FormData.
    body: formData,
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new Error((errorBody as any).error || `Upload failed with status ${response.status}`)
  }
  return response.json() as Promise<UploadDocumentResult>
}

export interface CollectionStatusCount {
  status: string
  count: number
}

/**
 * Fetch per-status document counts for a collection from the stats endpoint.
 * Returns an empty array on any error so the caller can degrade gracefully.
 */
export async function getCollectionStats(collection: string): Promise<CollectionStatusCount[]> {
  const url = `${API_BASE_URL}/${collection}/stats`
  const response = await fetch(url)
  if (!response.ok) {
    return []
  }
  const data = await response.json()
  return (data.stats ?? []) as CollectionStatusCount[]
}
