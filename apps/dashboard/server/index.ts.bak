/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * NOTE: Before you dunk on this, this is a prototype implementation
 * of our API and used only for development.
 * We'll extract a properly configured API server soon.
 */

// Initialize Byline config by importing the server config
import '../byline.server.config.js'

import type {
  CollectionDefinition,
  ModelArrayField,
  ModelCollection,
  ModelField,
  ModelScalarField,
} from '@byline/core'
import { getCollectionDefinition, getServerConfig } from '@byline/core'
import type { DocumentPatch } from '@byline/core/patches'
import { applyPatches } from '@byline/core/patches'
import { booleanSchema } from '@byline/shared/schemas'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import * as z from 'zod'

const app = Fastify({
  logger: true,
})

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})

const collectionListSchema = z.object({
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().min(1).max(100).optional(),
  order: z.string().optional(),
  desc: booleanSchema(true),
  query: z.string().optional(),
  locale: z.string().optional(),
})

const historySchema = z.object({
  document_id: z.string(),
  page: z.coerce.number().min(1).optional(),
  page_size: z.coerce.number().min(1).max(100).optional(),
  order: z.string().optional(),
  desc: booleanSchema(true),
  locale: z.string().optional(),
})

// type Collection = typeof schema.collections.$inferSelect

/**
 * ensureCollection
 *
 * Ensures that a collection exists in the database.
 * If it doesn't exist, creates it based on the collection definition from the registry.
 *
 * @param {string} path - The path of the collection to ensure.
 * @returns {Promise<{definition: CollectionDefinition, collection: Collection}>} The existing or newly created collection.
 */
async function ensureCollection(
  path: string
): Promise<{ definition: CollectionDefinition; collection } | null> {
  const collectionDefinition = getCollectionDefinition(path)
  if (collectionDefinition == null) {
    return null
  }

  const db = getServerConfig().db

  let collection = await db.queries.collections.getCollectionByPath(collectionDefinition.path)
  if (collection == null) {
    // Collection doesn't exist in database yet, create it
    await db.commands.collections.create(collectionDefinition.path, collectionDefinition)
    collection = await db.queries.collections.getCollectionByPath(collectionDefinition.path)
  }

  return { definition: collectionDefinition, collection }
}

// Minimal in-memory cache of ModelCollection definitions by collection path.
const modelCollections: Record<string, ModelCollection> = {}

function getModelCollectionForDefinition(definition: CollectionDefinition): ModelCollection {
  if (modelCollections[definition.path]) return modelCollections[definition.path]

  const fields: ModelField[] = definition.fields.map((field): ModelField => {
    const base = {
      id: field.name,
      label: field.label,
      localized: field.localized,
      required: field.required,
    }

    if (field.type === 'text' || field.type === 'richText') {
      const scalarField: ModelScalarField = {
        ...base,
        kind: 'scalar',
        scalarType: 'text',
      }
      return scalarField
    }

    if (field.type === 'checkbox') {
      const scalarField: ModelScalarField = {
        ...base,
        kind: 'scalar',
        scalarType: 'boolean',
      }
      return scalarField
    }

    if (field.type === 'integer') {
      const scalarField: ModelScalarField = {
        ...base,
        kind: 'scalar',
        scalarType: 'integer',
      }
      return scalarField
    }

    if (field.type === 'datetime') {
      const scalarField: ModelScalarField = {
        ...base,
        kind: 'scalar',
        scalarType: 'datetime',
      }
      return scalarField
    }

    if (field.type === 'array' && Array.isArray(field.fields)) {
      const arrayField: ModelArrayField = {
        ...base,
        kind: 'array',
        item: {
          id: `${field.name}_item`,
          kind: 'object',
          fields: field.fields.map((subField) => ({
            id: subField.name,
            label: subField.label,
            localized: subField.localized,
            required: subField.required,
            kind: 'scalar',
            scalarType: subField.type === 'checkbox' ? 'boolean' : 'text',
          })),
        },
      }
      return arrayField
    }

    const fallback: ModelScalarField = {
      ...base,
      kind: 'scalar',
      scalarType: 'text',
    }
    return fallback
  })

  const model: ModelCollection = {
    id: definition.path,
    path: definition.path,
    label: definition.labels.singular,
    fields,
  }

  modelCollections[definition.path] = model
  return model
}

/**
 * GET /api/:collection
 *
 * Get documents from a collection by page.
 * Defaults to page 1 and page size of 20.
 *
 * TODO: Implement with optional cursor-based pagination
 *
 */
app.get<{ Params: { collection: string } }>('/api/:collection', async (request, reply) => {
  const { collection: path } = request.params
  const search = request.query as Record<string, any>

  // Ensure we have a collection
  const config = await ensureCollection(path)
  if (config == null) {
    reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
    return
  }

  const searchParams = collectionListSchema.safeParse(search)

  const db = getServerConfig().db

  const result = await db.queries.documents.getDocumentsByPage({
    collection_id: config.collection.id,
    locale: 'en',
    ...searchParams.data,
  })
  return result
})

/**
 * POST /api/:collection
 *
 * Create a new document in a collection.
 * Expects the document data in the request body.
 *
 * TODO: Re-implement this with the new commands and queries.
 */
app.post<{ Params: { collection: string }; Body: Record<string, any> }>(
  '/api/:collection',
  async (request, reply) => {
    const { collection: path } = request.params
    // Ensure we have a collection
    const config = await ensureCollection(path)
    if (config == null) {
      reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
      return
    }

    const documentData = structuredClone(request.body)

    // TODO: Validate the documentData against the collection schema and
    // coerce values to the correct types.
    if (documentData.created_at) documentData.created_at = new Date(documentData.created_at)
    if (documentData.updated_at) documentData.updated_at = new Date(documentData.updated_at)
    if (documentData.publishedOn) documentData.publishedOn = new Date(documentData.publishedOn)

    // Ensure path is present. If not, generate one from title or random UUID.
    if (!documentData.path) {
      if (documentData.title) {
        documentData.path = documentData.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '')
      } else {
        documentData.path = crypto.randomUUID()
      }
    }

    const db = getServerConfig().db

    await db.commands.documents.createDocumentVersion({
      collectionId: config.collection.id,
      collectionConfig: config.definition,
      action: 'create',
      documentData,
      path: documentData.path,
      status: documentData.status,
      locale: 'en',
    })

    reply.code(200).send({ status: 'ok' })
    return
  }
)

/**
 * GET /api/:collection/:id
 *
 * Get a specific document by ID from a collection.
 * Note: this expects a logical document_id, and not a document version ID.
 */
app.get<{ Params: { collection: string; id: string } }>(
  '/api/:collection/:id',
  async (request, reply) => {
    const { collection: path, id } = request.params

    const config = await ensureCollection(path)
    if (config == null) {
      reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
      return
    }

    const db = getServerConfig().db

    const document = await db.queries.documents.getDocumentById({
      collection_id: config.collection.id,
      document_id: id,
      locale: 'en',
    })
    if (document == null) {
      reply.code(404).send({ error: 'Document not found' })
      return
    }
    reply.code(200).send({ document })
    return
  }
)

/**
 * GET /api/:collection/:id/history
 *
 * Get the version history for a specific document by ID in a collection.
 * Note: this expects a logical document_id, and not a document version ID.
 */
app.get<{ Params: { collection: string; id: string } }>(
  '/api/:collection/:id/history',
  async (request, reply) => {
    const { collection: path, id } = request.params
    const search = request.query as Record<string, any>

    // Ensure we have a collection
    const config = await ensureCollection(path)
    if (config == null) {
      reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
      return
    }

    const params = historySchema.safeParse(search)

    const db = getServerConfig().db

    const result = await db.queries.documents.getDocumentHistory({
      collection_id: config.collection.id,
      document_id: id,
      locale: 'en',
      ...params.data,
    })
    return result
  }
)

/**
 * PUT /api/:collection/:id
 *
 * Update a specific document by ID in a collection.
 * Expects the updated document data in the request body.
 *
 * NOTE: In our new immutable 'versioning-by-default' document model,
 * this will create a new version of the document.
 *
 */
app.put<{ Params: { collection: string; id: string }; Body: Record<string, any> }>(
  '/api/:collection/:id',
  async (request, reply) => {
    const { collection: path, id } = request.params

    // Ensure we have a collection
    const config = await ensureCollection(path)
    if (config == null) {
      reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
      return
    }

    const documentData = structuredClone(request.body)

    // TODO: Validate the documentData against the collection schema and
    // coerce values to the correct types.
    if (documentData.created_at) documentData.created_at = new Date(documentData.created_at)
    if (documentData.updated_at) documentData.updated_at = new Date(documentData.updated_at)
    if (documentData.publishedOn) documentData.publishedOn = new Date(documentData.publishedOn)

    const db = getServerConfig().db

    await db.commands.documents.createDocumentVersion({
      documentId: id,
      collectionId: config.collection.id,
      collectionConfig: config.definition,
      action: 'update',
      documentData,
      path: documentData.path,
      status: documentData.status,
      locale: 'en',
    })

    reply.code(200).send({ status: 'ok' })
    return
  }
)

/**
 * DELETE /api/:collection/:id
 * Delete a specific document by ID in a collection.
 *
 * NOTE: In our new immutable 'versioning-by-default' document
 * model, this will create a new version of the document with
 * is_deleted set to 'true'.
 *
 * TODO: Re-implement this with the new commands and queries.
 */
app.delete<{ Params: { collection: string; id: string } }>(
  '/api/:collection/:id',
  async (request, reply) => {
    const { collection: path, id } = request.params

    // Ensure we have a collection
    const collection = await ensureCollection(path)
    if (collection == null) {
      reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
      return
    }

    // TODO: Re-implement with our new queries and commands

    // try {
    //   // Get the document to ensure it exists
    //   const documentRecords = await queries.documents.findById(id)
    //   if (documentRecords.length === 0) {
    //     reply.code(404).send({ error: 'Document not found' })
    //     return
    //   }

    //   // Delete the document (cascading deletes will handle versions and field values)
    //   await commands.documents.delete(id)

    //   reply.code(200).send({ status: 'ok' })
    // } catch (error) {
    //   app.log.error(error)
    //   reply.code(500).send({ error: 'Internal app error' })
    // }
  }
)

/**
 * POST /api/docs/:id/patches
 *
 * Apply a set of patches to a document in the docs collection.
 * This is a prototype of our patch-based document update system.
 */
app.post<{
  Params: { collection: string; id: string }
  Body: { data: Record<string, any>; patches: DocumentPatch[] }
}>('/api/:collection/:id/patches', async (request, reply) => {
  const { collection: path, id } = request.params

  const config = await ensureCollection(path)
  if (config == null) {
    reply.code(404).send({ error: 'Collection not found in registry or could not be created.' })
    return
  }

  const db = getServerConfig().db

  // Get the current document, reconstructed from field values so we always
  // have a complete object including title, summary, content, etc.
  const latest = await db.queries.documents.getDocumentById({
    collection_id: config.collection.id,
    document_id: id,
    locale: 'en',
    reconstruct: true,
  })

  if (latest == null) {
    reply.code(404).send({ error: 'Document not found' })
    return
  }

  const originalData = latest as Record<string, any>

  const { patches } = request.body

  // Apply patches to the reconstructed database version to create the next version.
  const { doc: patchedDocument, errors } = applyPatches(
    getModelCollectionForDefinition(config.definition),
    originalData,
    patches
  )

  if (errors.length > 0) {
    app.log.warn({ errors, originalData, patches }, 'applyPatches failed')
    reply.code(400).send({ error: 'Failed to apply patches', details: errors })
    return
  }

  // Treat the patched doc as a plain record for now.
  const nextData = patchedDocument as Record<string, any>

  // Normalise known date-like fields to Date instances before persisting,
  // mirroring the behaviour in the generic POST/PUT handlers.
  if (typeof nextData.created_at === 'string') {
    nextData.created_at = new Date(nextData.created_at)
  }
  if (typeof nextData.updated_at === 'string') {
    nextData.updated_at = new Date(nextData.updated_at)
  }
  if (typeof nextData.publishedOn === 'string') {
    nextData.publishedOn = new Date(nextData.publishedOn)
  }

  await db.commands.documents.createDocumentVersion({
    documentId: id,
    collectionId: config.collection.id,
    collectionConfig: config.definition,
    action: 'update',
    documentData: nextData,
    path: nextData.path ?? originalData.path ?? '/',
    status: nextData.status ?? originalData.status ?? 'draft',
    locale: 'en',
  })

  reply.code(200).send({ status: 'ok' })
  return
})

const port = Number(process.env.PORT) || 3001
app
  .listen({ port })
  .then(() => app.log.info(`🚀 Server listening on port ${port}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
