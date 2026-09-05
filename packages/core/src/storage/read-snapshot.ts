import { ERR_DATABASE } from '../lib/errors.js'
import type { IDbAdapter, ReadSnapshotQueries } from '../@types/db-types.js'

/** Construct an allowlisted facade without leaking query classes or their executors. */
export async function runReadSnapshot<T>(
  queries: IDbAdapter['queries'],
  fn: (queries: ReadSnapshotQueries) => Promise<T>
): Promise<T> {
  let active = true
  function bind<O extends object, K extends keyof O>(source: O, names: readonly K[]): Pick<O, K> {
    return Object.freeze(
      Object.fromEntries(
        names.map((name) => [
          name,
          (...args: unknown[]) => {
            if (!active) throw ERR_DATABASE({ message: 'Read snapshot has expired' })
            return (source[name] as (...args: unknown[]) => unknown).apply(source, args)
          },
        ])
      )
    ) as Pick<O, K>
  }
  const facade: ReadSnapshotQueries = Object.freeze({
    collections: bind(queries.collections, [
      'getAllCollections',
      'getCollectionByPath',
      'getCollectionById',
    ]),
    audit: bind(queries.audit, ['getDocumentAuditLog', 'findAuditLog']),
    singletons: bind(queries.singletons, ['getMappedDocumentId']),
    documents: Object.freeze({
      ...bind(queries.documents, [
        'getDocumentRevision',
        'getDocumentById',
        'getCurrentVersionMetadata',
        'getCurrentPath',
        'getDocumentByPath',
        'getDocumentByVersion',
        'getDocumentsByVersionIds',
        'getDocumentsByDocumentIds',
        'getDocumentHistory',
        'getPublishedVersion',
        'getPublishedDocumentIds',
        'getDocumentCountsByStatus',
        'findDocuments',
        'getLastOrderKey',
        'getNeighborOrderKeys',
        'getCanonicalDocumentOrder',
        'getTreeAncestors',
        'getTreeChildren',
        'getTreeParent',
        'getTreeSubtree',
      ]),
      publishSchedules: bind(queries.documents.publishSchedules, ['get', 'list']),
    }),
  })
  try {
    return await fn(facade)
  } finally {
    active = false
  }
}
