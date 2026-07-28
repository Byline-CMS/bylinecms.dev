import type { DbTargetInspection } from './provisioner.js'

export type DbTargetState = 'missing' | 'empty' | 'byline-schema' | 'occupied-schema'

export function classifyDbTarget(inspection: DbTargetInspection): DbTargetState {
  if (!inspection.exists) return 'missing'
  if (inspection.objects.length === 0) return 'empty'
  return inspection.objects.some((name) => name.toLowerCase().startsWith('byline_'))
    ? 'byline-schema'
    : 'occupied-schema'
}
