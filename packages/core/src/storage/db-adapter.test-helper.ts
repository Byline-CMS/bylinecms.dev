import type { IDbAdapter } from '../@types/db-types.js'

/** Unit fixture only: unused capabilities throw, including transactions and snapshots.
 * Tests must explicitly implement every operation they exercise. Live adapter tests
 * supply the transaction/rollback evidence; this helper cannot simulate it. */
type Overrides = Partial<Omit<IDbAdapter, 'commands' | 'queries' | 'revisions'>> & {
  revisions?: Partial<IDbAdapter['revisions']>
  commands?: {
    collections?: Partial<IDbAdapter['commands']['collections']>
    documents?: Partial<Omit<IDbAdapter['commands']['documents'], 'publishSchedules'>> & {
      publishSchedules?: Partial<IDbAdapter['commands']['documents']['publishSchedules']>
    }
    counters?: Partial<IDbAdapter['commands']['counters']>
    audit?: Partial<IDbAdapter['commands']['audit']>
    singletons?: Partial<IDbAdapter['commands']['singletons']>
  }
  queries?: {
    collections?: Partial<IDbAdapter['queries']['collections']>
    documents?: Partial<Omit<IDbAdapter['queries']['documents'], 'publishSchedules'>> & {
      publishSchedules?: Partial<IDbAdapter['queries']['documents']['publishSchedules']>
    }
    audit?: Partial<IDbAdapter['queries']['audit']>
    singletons?: Partial<IDbAdapter['queries']['singletons']>
  }
}

export function testAdapter(overrides: Overrides = {}): IDbAdapter {
  const unused = (): never => {
    throw new Error('Unexpected adapter operation in unit fixture')
  }
  return {
    withTransaction: unused,
    withReadSnapshot: unused,
    ...overrides,
    revisions: {
      readStructure: unused,
      assertCompatibleSchema: unused,
      isInTransaction: () => false,
      lock: unused,
      advance: unused,
      ...overrides.revisions,
    },
    commands: {
      collections: {
        lockCollectionRegistration: unused,
        create: unused,
        update: unused,
        delete: unused,
        ...overrides.commands?.collections,
      },
      documents: {
        createDocumentVersion: unused,
        updateDocumentPath: unused,
        setDocumentAvailableLocales: unused,
        setDocumentStatus: unused,
        archivePublishedVersions: unused,
        softDeleteDocument: unused,
        restoreSoftDeletedDocument: unused,
        deleteDocumentLocale: unused,
        setOrderKey: unused,
        placeTreeNode: unused,
        removeFromTree: unused,
        promoteChildrenAndRemoveFromTree: unused,
        ...overrides.commands?.documents,
        publishSchedules: {
          lockDocuments: unused,
          schedule: unused,
          confirm: unused,
          cancel: unused,
          suspendForContentEdit: unused,
          claimDue: unused,
          lockClaim: unused,
          deleteClaim: unused,
          suspendClaimForContentEdit: unused,
          releaseClaim: unused,
          ...overrides.commands?.documents?.publishSchedules,
        },
      },
      counters: {
        ensureCounterGroup: unused,
        nextCounterValue: unused,
        nextScopedCounterValue: unused,
        ...overrides.commands?.counters,
      },
      audit: {
        append: unused,
        ...overrides.commands?.audit,
      },
      singletons: {
        lockSlot: unused,
        setMapping: unused,
        clearMapping: unused,
        ...overrides.commands?.singletons,
      },
    },
    queries: {
      collections: {
        getAllCollections: unused,
        getCollectionByPath: unused,
        getCollectionById: unused,
        ...overrides.queries?.collections,
      },
      documents: {
        getDocumentRevision: unused,
        getDocumentSystemFieldsForUpdate: unused,
        getDocumentById: unused,
        getCurrentVersionMetadata: unused,
        getCurrentPath: unused,
        getDocumentByPath: unused,
        getDocumentByVersion: unused,
        getDocumentsByVersionIds: unused,
        getDocumentsByDocumentIds: unused,
        getDocumentHistory: unused,
        getPublishedVersion: unused,
        getPublishedDocumentIds: unused,
        getDocumentCountsByStatus: unused,
        findDocuments: unused,
        getLastOrderKey: unused,
        getNeighborOrderKeys: unused,
        getCanonicalDocumentOrder: unused,
        getTreeAncestors: unused,
        getTreeChildren: unused,
        getTreeParent: unused,
        getTreeSubtree: unused,
        ...overrides.queries?.documents,
        publishSchedules: {
          get: unused,
          list: unused,
          ...overrides.queries?.documents?.publishSchedules,
        },
      },
      audit: {
        getDocumentAuditLog: unused,
        findAuditLog: unused,
        ...overrides.queries?.audit,
      },
      singletons: {
        getMappedDocumentId: unused,
        ...overrides.queries?.singletons,
      },
    },
  }
}
