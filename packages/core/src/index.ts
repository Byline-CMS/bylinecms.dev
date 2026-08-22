// ---------------------------------------------------------------------------
// @byline/core public surface.
//
// Subpath exports (see `package.json`):
//   - `.`             — main entry (this file); published
//   - `./zod-schemas`, `./logger`, `./package.json` — published
//   - `./patches`, `./workflow`, `./services`, `./scheduler` — NOT published
//
// The three unpublished subpaths are in-monorepo boundaries used by
// the admin server fns and the `@byline/client` SDK. They are
// registered in the main `exports` map (so workspace consumers and
// `tsc` can resolve them) but deliberately omitted from
// `publishConfig.exports` — they are not stable surface and should
// not be imported by external npm consumers. External access goes
// through this main entry or `@byline/client`.
// ---------------------------------------------------------------------------

export * from './@types/index.js'
export {
  type ActorAbilitySnapshot,
  applyBeforeRead,
  assertActorCanPerform,
  bindReadContextAuthority,
  COLLECTION_ABILITY_VERBS,
  type CollectionAbilityVerb,
  collectionAbilityKey,
  compileBeforeReadFilters,
  filterReadableCollections,
  registerCollectionAbilities,
} from './auth/index.js'
export {
  defineAdminConfig,
  defineServerConfig,
  getAdminConfig,
  getCollectionAdminConfig,
  getCollectionDefinition,
  getServerConfig,
  orderByContentLocale,
} from './config/config.js'
export {
  type CollectionGroupBucket,
  groupCollectionsForAdmin,
} from './config/group-collections.js'
export { resolveRoutes } from './config/routes.js'
export {
  validateAdminConfigs,
  validateBlockAdminConfigs,
  validateCollectionGroups,
} from './config/validate-admin-configs.js'
export { RESERVED_FIELD_NAMES } from './config/validate-collections.js'
export { type BylineCore, getBylineCore, initBylineCore } from './core.js'
export * from './defaults/default-values.js'
export {
  getHostRequestBridge,
  type HostCookieSetOptions,
  type HostRequestBridge,
  registerHostRequestBridge,
  tryGetHostRequestBridge,
} from './host/host-request-bridge.js'
export {
  BylineError,
  type DbErrorClassification,
  type DbErrorCode,
  DbErrorCodes,
  ERR_AUDIT_UNSUPPORTED,
  ERR_CONFLICT,
  ERR_DATABASE,
  ERR_NOT_FOUND,
  ERR_READ_BUDGET_EXCEEDED,
  ERR_READ_RECURSION,
  ERR_STORAGE,
  ERR_TREE_HOOK_COMMITTED,
  ERR_UNHANDLED,
  ERR_VALIDATION,
  ErrorCodes,
  type ErrorReport,
  TREE_HOOK_COMMITTED_MARKER,
  TREE_PLACEMENT_STALE_MARKER,
} from './lib/errors.js'
export {
  generateKeyBetween,
  generateNKeysBetween,
  validateOrderKey,
} from './lib/fractional-index.js'
export { type BylineLogger, getLogger } from './lib/logger.js'
export { AsyncRegistry, type RegisteredServices, Registry } from './lib/registry.js'
export * from './patches/index.js'
export * from './paths/index.js'
export {
  mergePredicates,
  type ParseContext,
  type ParsedSort,
  type ParsedWhere,
  parsePredicateFilters,
  parseSort,
  parseWhere,
} from './query/parse-where.js'
export {
  defineRecurringTask,
  MIN_INTERVAL_MS,
  MIN_LEASE_MS,
} from './scheduler/define-recurring-task.js'
export { getCollectionSchemasForPath } from './schemas/zod/cache.js'
export * from './services/index.js'
export * from './storage/index.js'
export { normalizeRootRelativeRedirect } from './utils/root-relative-redirect.js'
export {
  formatTextValue,
  looksLikeISODate,
  type SlugifierFn,
  type SlugifyContext,
  slugify,
} from './utils/slugify.js'
export {
  type FilenameSlugifierFn,
  type FilenameSlugifyContext,
  resolveUploadFilename,
  slugifyFilename,
} from './utils/slugify-filename.js'
export { getUploadFields, hasUploadField, isUploadField } from './utils/storage-utils.js'
export * from './workflow/index.js'
export type {
  ClaimedRecurringTask,
  ISchedulerStore,
  ReconcileTaskInput,
  RecurringTaskContext,
  RecurringTaskDefinition,
  RecurringTaskHealth,
  RecurringTaskResult,
  RecurringTaskStatus,
} from './scheduler/types.js'
