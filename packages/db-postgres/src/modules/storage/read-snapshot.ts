import type { CollectionDefinition, IDbAdapter } from '@byline/core'
import { runReadSnapshot } from '@byline/core'

import { DBManagerImpl } from '../../lib/db-manager.js'
import { createAuditQueries } from '../audit/audit-queries.js'
import { SingletonQueries } from './singletons.js'
import { createQueryBuilders } from './storage-queries.js'
import type { DBExecutor } from '../../lib/db-manager.js'

export function createReadSnapshot(
  db: DBExecutor,
  collections: readonly CollectionDefinition[],
  defaultLocale: string
): IDbAdapter['withReadSnapshot'] {
  return (fn) =>
    db.transaction(
      async (tx) => {
        const manager = new DBManagerImpl({ dbPool: tx })
        const queries = createQueryBuilders(tx, collections, defaultLocale, manager)
        return runReadSnapshot(
          { ...queries, audit: createAuditQueries(tx), singletons: new SingletonQueries(manager) },
          fn
        )
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    )
}
