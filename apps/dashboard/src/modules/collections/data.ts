import { getCollectionSchemasForPath } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'

export interface CollectionSearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
}

export interface HistorySearchParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  locale?: string
}

// API base URL is now same-origin (served by TanStack Start server routes).
const API_BASE_URL = '/api'

export async function getCollectionDocuments(collection: string, params: CollectionSearchParams) {
  const searchParams = new URLSearchParams()

  if (params.page != null) searchParams.set('page', params.page.toString())
  if (params.page_size != null) searchParams.set('page_size', params.page_size.toString())
  if (params.order != null) searchParams.set('order', params.order)
  if (params.desc != null) searchParams.set('desc', params.desc.toString())
  if (params.query != null) searchParams.set('query', params.query)
  if (params.locale != null) searchParams.set('locale', params.locale)

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
  return get.parse(rawData.document)
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
  patches: DocumentPatch[]
) {
  const url = `${API_BASE_URL}/${collection}/${id}/patches`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, patches }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to update document with patches')
  }
  return response.json()
}
