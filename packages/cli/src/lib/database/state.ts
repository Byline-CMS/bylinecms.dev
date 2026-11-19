import type { DatabaseAdapterId } from '../../types.js'
import type { DbTargetInspection } from './provisioner.js'

export type DbTargetState = 'missing' | 'empty' | 'byline-schema' | 'occupied-schema'

const postgresCoreNames = new Set([
  'byline_documents',
  'byline_document_versions',
  'byline_core_migrations',
])

export function classifyDbTarget(
  inspection: DbTargetInspection,
  adapter: DatabaseAdapterId
): DbTargetState {
  if (!inspection.exists) return 'missing'
  if (inspection.objects.length === 0) return 'empty'
  const core = inspection.objects.some((name) =>
    adapter === 'postgres'
      ? postgresCoreNames.has(name.toLowerCase())
      : name.toLowerCase().startsWith('byline_')
  )
  return core ? 'byline-schema' : 'occupied-schema'
}
