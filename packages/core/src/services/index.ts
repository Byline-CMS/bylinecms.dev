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
export { type AssignCounterValuesInput, assignCounterValues } from './assign-counter-values.js'
export {
  type BuildSearchDocumentOptions,
  buildSearchDocument,
  resolveSearchZones,
  type SearchSourceDocument,
} from './build-search-document.js'
export {
  type CollectionRecord,
  type EnsureCollectionsInput,
  ensureCollections,
} from './collection-bootstrap.js'
export {
  type DiscoverCounterGroupsInput,
  discoverCounterGroups,
} from './discover-counter-groups.js'
export * from './document-lifecycle/index.js'
export * from './document-read.js'
export * from './document-to-markdown.js'
export * from './field-upload.js'
export {
  type InterfaceI18nConfig,
  type TranslationDriftWarning,
  type ValidateTranslationsResult,
  validateTranslations,
} from './i18n-validator.js'
export {
  type CanonicalNumericFieldType,
  type CanonicalNumericValue,
  isCanonicalNumericValue,
  normalizeNumericFields,
  normalizeNumericValue,
} from './normalize-numeric-fields.js'
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
  resolveIdentityField,
  type UnresolvedRelationValue,
} from './populate.js'
export {
  buildRelationSummaryPopulateMap,
  type RelationTargetResolver,
  resolveRelationProjection,
} from './relation-projection.js'
export {
  type EmbedRichTextFieldsOptions,
  embedRichTextFields,
  resolveEmbedOnSave,
} from './richtext-embed.js'
export {
  collectRichTextLeaves,
  type PopulateRichTextFieldsOptions,
  populateRichTextFields,
  type RichTextAdapterPresence,
  type RichTextLeaf,
  resolvePopulateOnRead,
  validateRichTextFieldFlags,
} from './richtext-populate.js'
export {
  type SearchProviderPresence,
  validateSearchConfig,
} from './validate-search-config.js'
export { type FieldLeaf, walkFieldTree } from './walk-field-tree.js'
