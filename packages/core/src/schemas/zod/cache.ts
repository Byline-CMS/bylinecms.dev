import { getCollectionDefinition } from '../../config/config.js'
import { createTypedCollectionSchemas } from './builder.js'
import type { CollectionDefinition } from '../../@types/index.js'

type TypedSchemaSet = ReturnType<typeof createTypedCollectionSchemas>

const schemaCache = new Map<string, TypedSchemaSet>()

export const getCollectionSchemasForPath = (path: string): TypedSchemaSet => {
  const collectionDefinition = getCollectionDefinition(path)
  if (collectionDefinition == null) {
    throw new Error(`Collection not found for path: ${path}`)
  }
  return getCollectionSchemas(collectionDefinition)
}

// Get schemas for a collection (with caching)
export const getCollectionSchemas = (collection: CollectionDefinition): TypedSchemaSet => {
  const cacheKey = collection.path

  if (schemaCache.has(cacheKey) === false) {
    schemaCache.set(cacheKey, createTypedCollectionSchemas(collection))
  }

  return schemaCache.get(cacheKey) || createTypedCollectionSchemas(collection)
}

// Aliases for consistency (these are the same as above now)
export const getTypedCollectionSchemasForPath = getCollectionSchemasForPath
export const getTypedCollectionSchemas = getCollectionSchemas

// Clear cache for a specific collection or all collections
export const clearSchemaCache = (collectionPath?: string): void => {
  if (collectionPath) {
    for (const key of schemaCache.keys()) {
      if (key === collectionPath) {
        schemaCache.delete(key)
      }
    }
  } else {
    schemaCache.clear()
  }
}

// Get cache statistics
export const getCacheStats = () => ({
  size: schemaCache.size,
  keys: Array.from(schemaCache.keys()),
})
