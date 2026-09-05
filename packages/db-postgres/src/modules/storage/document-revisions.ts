import {
  assertDocumentVersionParent,
  type DocumentRevisionReceipt,
  type DocumentRevisionStore,
  type DocumentRevisionTarget,
  type DocumentStructuralState,
  documentRevisionFromDatabase,
  ERR_DATABASE,
  ERR_DOCUMENT_STALE,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  type LockedDocumentRevision,
  parseDocumentRevision,
} from '@byline/core'
import { and, desc, eq, sql } from 'drizzle-orm'

import {
  documentAvailableLocales,
  documentPaths,
  documents,
  documentVersions,
} from '../../database/schema/index.js'
import { assertRevisionSchema } from '../../lib/revision-schema.js'
import type { DBManager } from '../../lib/db-manager.js'

export class DocumentRevisions implements DocumentRevisionStore {
  private readonly issued = new WeakMap<
    LockedDocumentRevision,
    { scope: object; token: object; documentId: string; collectionId: string; revision: number }
  >()
  private readonly lockOrder = new WeakMap<object, string>()
  private readonly acquiring = new WeakSet<object>()
  constructor(private readonly manager: DBManager) {}

  async readStructure(params: {
    collectionId: string
    documentIds?: readonly string[]
    parentDocumentId?: string
  }): Promise<DocumentStructuralState[]> {
    this.scope()
    const ids = params.documentIds ?? []
    const filtered = params.documentIds !== undefined || params.parentDocumentId !== undefined
    const selection = ids.length
      ? sql`d.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql`FALSE`
    const result = await this.manager.get().execute(sql`
      SELECT d.id, d.revision, d.order_key,
        r.child_document_id, r.parent_document_id, r.order_key AS tree_order_key,
        EXISTS (SELECT 1 FROM byline_document_versions v WHERE v.document_id = d.id AND v.is_deleted = false) AS live
      FROM byline_documents d
      LEFT JOIN byline_document_relationships r ON r.child_document_id = d.id
      WHERE d.collection_id = ${params.collectionId}
        AND (${!filtered} OR ${selection} OR r.parent_document_id = ${params.parentDocumentId ?? null})
      ORDER BY d.id
    `)
    type Row = {
      id: string
      revision: number | string
      order_key: string | null
      child_document_id: string | null
      parent_document_id: string | null
      tree_order_key: string | null
      live: boolean | number
    }
    const rows = result.rows as Row[]
    return rows.map((row) => ({
      documentId: row.id,
      revision: documentRevisionFromDatabase(row.revision),
      orderKey: row.order_key,
      placed: row.child_document_id !== null,
      parentDocumentId: row.parent_document_id,
      treeOrderKey: row.tree_order_key,
      live: Boolean(row.live),
    }))
  }

  isInTransaction(): boolean {
    return this.manager.isInTransaction()
  }
  assertCompatibleSchema(): Promise<void> {
    return assertRevisionSchema(this.manager.get())
  }

  private scope(): object {
    const scope = this.manager.getTransactionScope()
    if (scope == null)
      throw ERR_DATABASE({
        message: 'Document revision primitives require an active adapter transaction.',
      })
    return scope
  }

  async lock(
    targets: readonly DocumentRevisionTarget[]
  ): Promise<readonly LockedDocumentRevision[]> {
    const scope = this.scope()
    if (this.acquiring.has(scope))
      throw ERR_DATABASE({
        message: 'Concurrent document lock requests inside one transaction are not allowed.',
      })
    this.acquiring.add(scope)
    try {
      return await this.lockSequentially(targets, scope)
    } finally {
      this.acquiring.delete(scope)
    }
  }

  private async lockSequentially(
    targets: readonly DocumentRevisionTarget[],
    scope: object
  ): Promise<readonly LockedDocumentRevision[]> {
    const token = this.manager.getTransactionToken()!
    // Validate all caller values before acquiring even the first lock.
    const ordered = targets
      .map((target) => {
        if (
          ![target.documentId, target.collectionId].every(
            (id) =>
              typeof id === 'string' &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
          )
        ) {
          throw ERR_VALIDATION({
            message: 'Revision targets require valid document and collection UUIDs.',
          })
        }
        return {
          ...target,
          documentId: target.documentId.toLowerCase(),
          collectionId: target.collectionId.toLowerCase(),
          expectedRevision: parseDocumentRevision(target.expectedRevision),
        }
      })
      .sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0))
    if (new Set(ordered.map((target) => target.documentId)).size !== ordered.length) {
      throw ERR_VALIDATION({ message: 'Duplicate document revision lock targets are not allowed.' })
    }
    const last = this.lockOrder.get(scope)
    if (last != null && ordered.some((target) => target.documentId <= last)) {
      throw ERR_DATABASE({
        message:
          'Document revision locks must be acquired once in increasing document identity order, including across savepoints.',
      })
    }
    const executor = this.manager.get()
    const locked: LockedDocumentRevision[] = []
    for (const target of ordered) {
      const [document] = await executor
        .select({
          revision: sql<unknown>`${documents.revision}`,
          sourceLocale: documents.source_locale,
        })
        .from(documents)
        .where(
          and(eq(documents.id, target.documentId), eq(documents.collection_id, target.collectionId))
        )
        .for('update')
      this.lockOrder.set(scope, target.documentId)
      if (document == null) throw ERR_NOT_FOUND({ message: 'Document is unavailable.' })
      const [current] = await executor
        .select({ id: documentVersions.id, status: documentVersions.status })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.document_id, target.documentId),
            eq(documentVersions.is_deleted, false)
          )
        )
        .orderBy(desc(documentVersions.id))
        .limit(1)
      if (current == null) {
        const [anyVersion] = await executor
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .where(eq(documentVersions.document_id, target.documentId))
          .limit(1)
        if (anyVersion != null) throw ERR_NOT_FOUND({ message: 'Document is unavailable.' })
      }
      const revision = documentRevisionFromDatabase(document.revision)
      if (revision !== target.expectedRevision)
        throw ERR_DOCUMENT_STALE({
          message: 'This document has changed. Reload it before making further changes.',
          details: {
            reason: 'revision_mismatch',
            documentId: target.documentId,
            expectedRevision: target.expectedRevision,
            currentRevision: revision,
          },
        })
      assertDocumentVersionParent({
        documentId: target.documentId,
        locale: target.locale,
        previousVersionId: target.previousVersionId,
        currentVersionId: current?.id ?? null,
      })
      const [path] = await executor
        .select({ path: documentPaths.path })
        .from(documentPaths)
        .where(
          and(
            eq(documentPaths.document_id, target.documentId),
            eq(documentPaths.locale, document.sourceLocale)
          )
        )
        .limit(1)
      const locales = await executor
        .select({ locale: documentAvailableLocales.locale })
        .from(documentAvailableLocales)
        .where(eq(documentAvailableLocales.document_id, target.documentId))
      const observation: LockedDocumentRevision = Object.freeze({
        documentId: target.documentId,
        collectionId: target.collectionId,
        revision,
        currentVersionId: current?.id ?? null,
        status: current?.status ?? null,
        sourceLocale: document.sourceLocale,
        path: path?.path ?? null,
        availableLocales: Object.freeze(locales.map((row) => row.locale).sort()),
      })
      this.issued.set(observation, {
        scope,
        token,
        documentId: target.documentId,
        collectionId: target.collectionId,
        revision,
      })
      locked.push(observation)
    }
    return Object.freeze(locked)
  }

  async advance(locked: LockedDocumentRevision): Promise<DocumentRevisionReceipt> {
    const scope = this.scope()
    const original = this.issued.get(locked)
    if (
      original == null ||
      original.scope !== scope ||
      !this.manager.isTransactionTokenActive(original.token)
    )
      throw ERR_DATABASE({
        message: 'Document revision observation does not belong to this active transaction.',
      })
    if (original.revision === Number.MAX_SAFE_INTEGER)
      throw ERR_DATABASE({
        message:
          'Document revision exhausted its safe integer range; the mutation was not committed.',
      })
    const next = original.revision + 1
    const executor = this.manager.get()
    const predicate = and(
      eq(documents.id, original.documentId),
      eq(documents.collection_id, original.collectionId),
      eq(documents.revision, original.revision)
    )
    const changed = await executor
      .update(documents)
      .set({ revision: next })
      .where(predicate)
      .returning({ id: documents.id })
    const count = changed.length
    if (count !== 1)
      throw ERR_DATABASE({
        message:
          'Locked document revision was already advanced or changed; roll back the mutation.',
      })
    return { documentId: original.documentId, revision: next }
  }
}
