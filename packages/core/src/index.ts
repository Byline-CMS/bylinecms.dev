// ---------------------------------------------------------------------------
// @byline/core public surface.
//
// The main entry (this file) is browser-safe. Capability-specific surfaces use
// the explicit subpaths declared in `package.json`, such as `./codegen` and
// the server-only `./scheduler` entry.
//
// Every key in the package's `exports` map is included in the published npm
// package and may be imported by external consumers. A subpath's primary use
// inside this monorepo does not make it private; removing or renaming one is a
// breaking package-surface change.
// ---------------------------------------------------------------------------

export * from './@types/index.js'
export {
  type ActorAbilitySnapshot,
  applyBeforeRead,
  assertActorCanPerform,
  bindReadContextAuthority,
  COLLECTION_ABILITY_VERBS,
  type CollectionAbilityResource,
  type CollectionAbilityResourceDescriptor,
  type CollectionAbilityVerb,
  collectionAbilityKey,
  compileBeforeReadFilters,
  type DocumentAbilityResource,
  type DocumentAbilityVerbFor,
  documentAbilityKey,
  filterReadableCollections,
  registerCollectionAbilities,
  registerDocumentAbilities,
  registerSingletonAbilities,
  SINGLETON_ABILITY_VERBS,
  type SingletonAbilityResource,
  type SingletonAbilityResourceDescriptor,
  type SingletonAbilityVerb,
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
