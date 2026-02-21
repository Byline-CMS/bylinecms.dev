import type { z } from 'zod'

import type { getCollectionSchemasForPath } from './cache.js'

// Helper type to infer all schema types from a collection schemas object
export type CollectionSchemaTypes<T extends ReturnType<typeof getCollectionSchemasForPath>> = {
  BaseType: z.infer<T['base']>
  FullType: z.infer<T['full']>
  ListType: z.infer<T['list']>
  HistoryType: z.infer<T['history']>
  CreateType: z.infer<T['create']>
  GetType: z.infer<T['get']>
  UpdateType: z.infer<T['update']>
}

// Generic type for any collection's schema types
export type AnyCollectionSchemaTypes = CollectionSchemaTypes<
  ReturnType<typeof getCollectionSchemasForPath>
>
