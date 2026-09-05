/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/** The revision observed before preparing an existing-document mutation. */
export interface DocumentWritePrecondition {
  expectedRevision: number
}

/** An empty singleton slot must be asserted explicitly, never by omission. */
export type SingletonSavePrecondition =
  | { expectedState: 'empty'; expectedRevision?: never }
  | { expectedRevision: number; expectedState?: never }

/** Returned only for the document state committed by a mutation. */
export interface DocumentRevisionReceipt {
  documentId: string
  revision: number
}

/** Preserve operation-specific results, including committed side-effect failures. */
export type DocumentMutationResult<T extends object> = T & DocumentRevisionReceipt

export interface StructuralMutationReceipt extends DocumentRevisionReceipt {
  /** Hosts must authorize/filter these identities before returning them to clients. */
  affectedDocuments: DocumentRevisionReceipt[]
  scheduledPublicationsNeedReconfirmation: boolean
}

export type DocumentStaleDetails =
  | {
      reason: 'revision_mismatch'
      documentId: string
      expectedRevision: number
      currentRevision: number
    }
  | {
      reason: 'version_parent_mismatch'
      documentId: string
      previousVersionId: string
      currentVersionId: string | null
    }
  | {
      reason: 'singleton_slot_changed'
      singletonPath: string
      expectedState: 'empty'
      currentState: 'document'
    }

export type DocumentRevisionValidationDetails =
  | { reason: 'missing_document_revision' }
  | { reason: 'invalid_document_revision' }

/** Adapter-internal inputs. Lifecycle services authorize these targets before locking. */
export interface DocumentRevisionTarget extends DocumentWritePrecondition {
  documentId: string
  collectionId: string
  previousVersionId?: string
  locale?: string
}

/** An adapter-issued observation valid only inside its originating transaction. */
export interface LockedDocumentRevision extends DocumentRevisionReceipt {
  readonly collectionId: string
  readonly currentVersionId: string | null
  readonly status: string | null
  readonly sourceLocale: string
  readonly path: string | null
  readonly availableLocales: readonly string[]
}

/** Transaction-scoped structural state; used under an exclusive collection lock. */
export interface DocumentStructuralState {
  documentId: string
  revision: number
  orderKey: string | null
  placed: boolean
  parentDocumentId: string | null
  treeOrderKey: string | null
  live: boolean
}

/** Storage primitives; public SDK mutations compose them inside the service boundary. */
export interface DocumentRevisionStore {
  readStructure(params: {
    collectionId: string
    documentIds?: readonly string[]
    parentDocumentId?: string
  }): Promise<DocumentStructuralState[]>
  assertCompatibleSchema(): Promise<void>
  isInTransaction(): boolean
  /** Lock in stable document identity order, then validate every observation before returning. */
  lock(targets: readonly DocumentRevisionTarget[]): Promise<readonly LockedDocumentRevision[]>
  /** Advance an authentic locked observation exactly once; participates in rollback/savepoints. */
  advance(locked: LockedDocumentRevision): Promise<DocumentRevisionReceipt>
}
