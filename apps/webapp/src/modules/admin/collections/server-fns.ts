/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Server functions for admin collection operations.
 *
 * Each function runs on the server and queries the database directly
 * via the @byline/core services layer. In SPA mode, TanStack Start
 * compiles these to RPC endpoints automatically — semantically identical
 * to the REST routes in /admin/api/, without the HTTP round-trip overhead.
 *
 * The public REST routes under /admin/api/ are kept intact as the
 * external API surface (for mobile clients, CLI tools, Next.js, etc.).
 * These server functions serve the internal admin dashboard UI.
 */

import { createServerFn } from '@tanstack/react-start'

import { getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import type { DocumentLifecycleContext } from '@byline/core/services'
import {
  ConflictError,
  changeDocumentStatus,
  createDocument,
  DocumentNotFoundError,
  deleteDocument as deleteDocumentService,
  InvalidTransitionError,
  PatchApplicationError,
  unpublishDocument as unpublishDocumentService,
  updateDocument,
  updateDocumentWithPatches,
} from '@byline/core/services'

import { ensureCollection } from '@/lib/api-utils'

/**
 * Deep-serialise a value through JSON to convert Date objects to ISO strings.
 * This replicates the JSON.stringify/parse that previously happened automatically
 * via the HTTP response when data.ts used fetch(). Without it, Date instances
 * returned directly by the DB driver fail Zod's z.string() checks on the client.
 */
function serialise<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Shared param types (re-exported so data.ts can forward them to callers)
// ---------------------------------------------------------------------------

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

export interface CollectionStatusCount {
  status: string
  count: number
}

// ---------------------------------------------------------------------------
// List documents
// ---------------------------------------------------------------------------

export const listDocumentsFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; params: CollectionSearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, params } = data
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const result = await db.queries.documents.getDocumentsByPage({
      collection_id: config.collection.id,
      locale: params.locale ?? 'en',
      page: params.page,
      page_size: params.page_size,
      order: params.order,
      desc: params.desc,
      query: params.query,
      status: params.status,
    })
    return serialise(result)
  })

// ---------------------------------------------------------------------------
// Get document (current version, with optional published-version metadata)
// ---------------------------------------------------------------------------

export const getDocumentFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id } = data
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db

    const document = await db.queries.documents.getDocumentById({
      collection_id: config.collection.id,
      document_id: id,
      locale: 'en',
    })

    if (!document) throw new Error('Document not found')

    // If the current version is not published, check whether a separate
    // published version exists so the UI can show a "published is live" badge.
    let publishedVersion: {
      document_version_id: string
      document_id: string
      status: string
      created_at: Date
      updated_at: Date
    } | null = null

    if ((document as any).status !== 'published') {
      publishedVersion = await db.queries.documents.getPublishedVersion({
        collection_id: config.collection.id,
        document_id: id,
      })
    }

    return serialise({ document, publishedVersion })
  })

// ---------------------------------------------------------------------------
// Get document by specific version ID (for history / diff views)
// ---------------------------------------------------------------------------

export const getDocumentByVersionFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; versionId: string }) => input)
  .handler(async ({ data }) => {
    const { collection: path, versionId } = data
    // ensureCollection validates the path is known — not strictly needed for a
    // version fetch, but keeps auth/404 behaviour consistent.
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const document = await db.queries.documents.getDocumentByVersion({
      document_version_id: versionId,
      locale: 'en',
    })

    if (!document) throw new Error('Document version not found')
    return serialise({ document })
  })

// ---------------------------------------------------------------------------
// Get document version history
// ---------------------------------------------------------------------------

export const getDocumentHistoryFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string; id: string; params: HistorySearchParams }) => input)
  .handler(async ({ data }) => {
    const { collection: path, id, params } = data
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const result = await db.queries.documents.getDocumentHistory({
      collection_id: config.collection.id,
      document_id: id,
      locale: params.locale ?? 'en',
      page: params.page,
      page_size: params.page_size,
      order: params.order,
      desc: params.desc,
    })
    return serialise(result)
  })

// ---------------------------------------------------------------------------
// Create document
// ---------------------------------------------------------------------------

export const createDocumentFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; data: any }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, data: documentData } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    await createDocument(ctx, {
      data: structuredClone(documentData),
      status: documentData.status,
      locale: 'en',
    })

    return { status: 'ok' as const }
  })

// ---------------------------------------------------------------------------
// Update document (full replace — creates a new immutable version)
// ---------------------------------------------------------------------------

export const updateDocumentFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string; data: any }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id, data: documentData } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    await updateDocument(ctx, {
      documentId: id,
      data: structuredClone(documentData),
      locale: 'en',
    })

    return { status: 'ok' as const }
  })

// ---------------------------------------------------------------------------
// Apply patches
// ---------------------------------------------------------------------------

export const applyPatchesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      collection: string
      id: string
      patches: DocumentPatch[]
      document_version_id?: string
    }) => input
  )
  .handler(async ({ data: input }) => {
    const { collection: path, id, patches, document_version_id } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    try {
      await updateDocumentWithPatches(ctx, {
        documentId: id,
        patches,
        documentVersionId: document_version_id,
        locale: 'en',
      })
    } catch (error) {
      if (error instanceof ConflictError) {
        const err = new Error(`Conflict: ${error.message}`) as Error & {
          currentVersionId?: string
          yourVersionId?: string
        }
        err.currentVersionId = error.currentVersionId
        err.yourVersionId = error.yourVersionId
        throw err
      }
      if (error instanceof PatchApplicationError) {
        throw new Error(`Failed to apply patches: ${(error.errors ?? []).join(', ')}`)
      }
      throw error
    }

    return { status: 'ok' as const }
  })

// ---------------------------------------------------------------------------
// Change document workflow status
// ---------------------------------------------------------------------------

export const changeStatusFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string; status: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id, status: nextStatus } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    try {
      const result = await changeDocumentStatus(ctx, {
        documentId: id,
        nextStatus,
        locale: 'en',
      })
      return {
        status: 'ok' as const,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
      }
    } catch (error) {
      if (error instanceof DocumentNotFoundError) throw new Error('Document not found')
      if (error instanceof InvalidTransitionError)
        throw new Error(`Invalid transition: ${error.message}`)
      throw error
    }
  })

// ---------------------------------------------------------------------------
// Unpublish document (archive the live published version)
// ---------------------------------------------------------------------------

export const unpublishDocumentFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const db = getServerConfig().db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
    }

    const result = await unpublishDocumentService(ctx, { documentId: id })

    if (result.archivedCount === 0) throw new Error('No published version found for this document')

    return { status: 'ok' as const, archivedCount: result.archivedCount }
  })

// ---------------------------------------------------------------------------
// Delete document (soft-delete — marks all versions as deleted)
// ---------------------------------------------------------------------------

export const deleteDocumentFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { collection: string; id: string }) => input)
  .handler(async ({ data: input }) => {
    const { collection: path, id } = input
    const config = await ensureCollection(path)
    if (!config) throw new Error('Collection not found')

    const serverConfig = getServerConfig()
    // Resolve the storage provider so the lifecycle service can clean up
    // uploaded files and variants on deletion.
    const storage = config.definition.upload?.storage ?? serverConfig.storage
    const db = serverConfig.db
    const ctx: DocumentLifecycleContext = {
      db,
      definition: config.definition,
      collectionId: config.collection.id,
      collectionPath: path,
      ...(storage ? { storage } : {}),
    }

    try {
      const result = await deleteDocumentService(ctx, { documentId: id })
      return { status: 'ok' as const, deletedVersionCount: result.deletedVersionCount }
    } catch (err: any) {
      if (err.name === 'DocumentNotFoundError') throw new Error('Document not found')
      throw err
    }
  })

// ---------------------------------------------------------------------------
// Collection stats (per-status document counts)
// ---------------------------------------------------------------------------

export const getCollectionStatsFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { collection: string }) => input)
  .handler(async ({ data }) => {
    const config = await ensureCollection(data.collection)
    if (!config) return { stats: [] as CollectionStatusCount[] }

    const db = getServerConfig().db
    const counts = await db.queries.documents.getDocumentCountsByStatus({
      collection_id: config.collection.id,
    })

    return { stats: counts as CollectionStatusCount[] }
  })
