import type { AfterCreateContext, CollectionHookFn, CollectionHooks } from '@byline/core'
import { defineHooks } from '@byline/core'

import { invalidateCollection, invalidateDocument } from '@/lib/cache/with-cache'
import { getSystemBylineClient } from '../client.server.js'
import { runSideEffects } from './run-side-effects.js'
import type { CollectionPath } from '../generated/collection-types.js'

interface PublicLifecycleHooksOptions {
  collectionPath: CollectionPath
  listBearing: boolean
  onCreate?: CollectionHookFn<AfterCreateContext>
  invalidateTree?: boolean
}

/** Server-only cache and search hooks shared by public document collections. */
export function createPublicLifecycleHooks({
  collectionPath,
  listBearing,
  onCreate,
  invalidateTree = false,
}: PublicLifecycleHooksOptions): CollectionHooks {
  const list = listBearing ? { list: true } : {}
  const structural = { ...list, sitemap: true }

  return defineHooks({
    afterCreate: async (context) => {
      await onCreate?.(context)
      await runSideEffects(
        `${collectionPath} afterCreate`,
        () => invalidateDocument(collectionPath, context.path, structural),
        () => getSystemBylineClient().collection(collectionPath).indexDocument(context.documentId)
      )
    },
    afterUpdate: async ({ path, documentId, originalData }) => {
      await runSideEffects(
        `${collectionPath} afterUpdate`,
        () =>
          invalidateDocument(collectionPath, path, {
            prevPath: (originalData as { path?: string } | undefined)?.path,
            ...list,
          }),
        () => getSystemBylineClient().collection(collectionPath).indexDocument(documentId)
      )
    },
    afterSystemFieldsChange: async ({
      documentId,
      previousPath,
      currentPath,
      requested,
      reconciliation,
    }) => {
      const invalidate = () =>
        reconciliation && requested.path
          ? invalidateCollection(collectionPath)
          : currentPath != null
            ? invalidateDocument(collectionPath, currentPath, {
                prevPath: previousPath,
                ...structural,
              })
            : undefined

      await runSideEffects(
        `${collectionPath} afterSystemFieldsChange`,
        invalidate,
        ...(requested.path
          ? [() => getSystemBylineClient().collection(collectionPath).indexDocument(documentId)]
          : [])
      )
    },
    afterStatusChange: ({ path, documentId }) =>
      runSideEffects(
        `${collectionPath} afterStatusChange`,
        () => invalidateDocument(collectionPath, path, structural),
        () => getSystemBylineClient().collection(collectionPath).indexDocument(documentId)
      ),
    afterUnpublish: ({ path, documentId }) =>
      runSideEffects(
        `${collectionPath} afterUnpublish`,
        () => invalidateDocument(collectionPath, path, structural),
        () => getSystemBylineClient().collection(collectionPath).indexDocument(documentId)
      ),
    afterDelete: ({ path, documentId }) =>
      runSideEffects(
        `${collectionPath} afterDelete`,
        () => getSystemBylineClient().collection(collectionPath).removeFromIndex(documentId),
        () => invalidateDocument(collectionPath, path, structural)
      ),
    ...(invalidateTree
      ? { afterTreeChange: () => invalidateCollection(collectionPath) }
      : undefined),
  })
}
