import { assertActorCanPerform } from '../../auth/assert-actor-can-perform.js'
import { ERR_CONFLICT, ERR_VALIDATION } from '../../lib/errors.js'
import { generateKeyBetween, generateNKeysBetween } from '../../lib/fractional-index.js'
import { AUDIT_ACTIONS, auditActor, requireAuditCapability } from './audit.js'
import { commitGuardedDocumentMutation, readDocumentForMutation } from './revision-guard.js'
import type { StructuralMutationReceipt } from '../../@types/index.js'
import type { DocumentLifecycleContext } from './context.js'

/** Flat ordering and any sibling-key repairs share one guarded transaction. */
export async function reorderDocument(
  ctx: DocumentLifecycleContext,
  params: {
    documentId: string
    expectedRevision: number
    beforeDocumentId?: string | null
    afterDocumentId?: string | null
  }
): Promise<StructuralMutationReceipt & { orderKey: string }> {
  assertActorCanPerform(ctx.requestContext, ctx.definition, 'update')
  await readDocumentForMutation(ctx, params)
  if (ctx.definition.orderable !== true || ctx.definition.tree === true)
    throw ERR_VALIDATION({ message: 'Flat reorder requires an orderable, non-tree collection' })
  const audit = requireAuditCapability(ctx.db)
  const committed = await commitGuardedDocumentMutation(
    ctx,
    params,
    async () => {
      const rows = await ctx.db.withReadSnapshot((queries) =>
        queries.documents.getCanonicalDocumentOrder({ collection_id: ctx.collectionId })
      )
      const keys = new Map(rows.map((row) => [row.id, row.order_key]))
      const keyed = rows.filter((row) => row.order_key !== null)
      const corrupt = keyed.some(
        (row, index) => index > 0 && row.order_key! <= keyed[index - 1]!.order_key!
      )
      if (corrupt) {
        const replacements = generateNKeysBetween(null, null, rows.length)
        rows.forEach((row, index) => {
          keys.set(row.id, replacements[index]!)
        })
      } else {
        const missing = rows.filter((row) => row.order_key === null)
        const replacements = generateNKeysBetween(
          keyed.at(-1)?.order_key ?? null,
          null,
          missing.length
        )
        missing.forEach((row, index) => {
          keys.set(row.id, replacements[index]!)
        })
      }
      const siblings = rows.filter((row) => row.id !== params.documentId)
      let leftId = params.beforeDocumentId ?? null
      const rightId = params.afterDocumentId ?? null
      if (leftId === null && rightId === null) leftId = siblings.at(-1)?.id ?? null
      const leftIndex = leftId === null ? -1 : siblings.findIndex((row) => row.id === leftId)
      const rightIndex =
        rightId === null ? siblings.length : siblings.findIndex((row) => row.id === rightId)
      if (
        (leftId !== null && leftIndex < 0) ||
        (rightId !== null && rightIndex < 0) ||
        rightIndex !== leftIndex + 1
      )
        throw ERR_CONFLICT({
          message: 'The supplied ordering neighbors have changed. Reload before reordering.',
        })
      const left = leftId === null ? null : (keys.get(leftId) ?? null)
      const right = rightId === null ? null : (keys.get(rightId) ?? null)
      const current = keys.get(params.documentId)
      const orderKey =
        current && (left === null || left < current) && (right === null || current < right)
          ? current
          : generateKeyBetween(left, right)
      keys.set(params.documentId, orderKey)
      let changed = false
      for (const row of rows) {
        const next = keys.get(row.id)
        if (next === undefined || next === null || next === row.order_key) continue
        await ctx.db.commands.documents.setOrderKey({ document_id: row.id, order_key: next })
        await audit.append({
          documentId: row.id,
          collectionId: ctx.collectionId,
          ...auditActor(ctx),
          action: AUDIT_ACTIONS.orderChanged,
          field: 'order_key',
          before: row.order_key,
          after: next,
        })
        if (row.id === params.documentId) changed = true
      }
      return { value: orderKey, changed }
    },
    { structuralScope: 'collection' }
  )
  return {
    documentId: params.documentId,
    orderKey: committed.value,
    revision: committed.revision,
    affectedDocuments: committed.affectedDocuments,
    scheduledPublicationsNeedReconfirmation: committed.scheduledPublicationsNeedReconfirmation,
  }
}
