import { ERR_DATABASE } from '../lib/errors.js'
import type { IDbAdapter } from '../@types/db-types.js'

/** Must run before collection reconciliation, counters, or boot maintenance writes. */
export async function assertDocumentRevisionCapability(db: IDbAdapter): Promise<void> {
  if (
    typeof db.withTransaction !== 'function' ||
    typeof db.withReadSnapshot !== 'function' ||
    typeof db.commands?.collections?.lockCollectionRegistration !== 'function' ||
    typeof db.commands?.documents?.publishSchedules?.lockDocuments !== 'function' ||
    db.revisions == null ||
    ['assertCompatibleSchema', 'isInTransaction', 'lock', 'advance', 'readStructure'].some(
      (name) => typeof (db.revisions as unknown as Record<string, unknown>)[name] !== 'function'
    )
  ) {
    throw ERR_DATABASE({
      message:
        'Byline requires a revision-capable database adapter. Upgrade the adapter and document revision schema while all writers/workers are fenced.',
    })
  }
  await db.revisions.assertCompatibleSchema()
}
