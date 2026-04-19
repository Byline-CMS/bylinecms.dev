// packages/core/src/services/index.ts

export {
  ERR_CONFLICT,
  ERR_INVALID_TRANSITION,
  ERR_NOT_FOUND,
  ERR_PATCH_FAILED,
  ERR_READ_BUDGET_EXCEEDED,
  ERR_VALIDATION,
} from '../lib/errors.js'
export { normaliseDateFields } from '../utils/normalise-dates.js'
export * from './document-lifecycle.js'
export * from './document-read.js'
export * from './document-upload.js'
export {
  type CycleRelationValue,
  createReadContext,
  type PopulatedRelationValue,
  type PopulateFieldOptions,
  type PopulateFieldSpec,
  type PopulateMap,
  type PopulateOptions,
  type PopulateSpec,
  populateDocuments,
  type ReadContext,
  type UnresolvedRelationValue,
} from './populate.js'
export {
  buildRelationSummaryPopulateMap,
  type RelationTargetResolver,
  resolveRelationProjection,
} from './relation-projection.js'
