/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

export { fingerprintCollection } from './collection-fingerprint.js'
export {
  ALL_STORE_TYPES,
  type FieldStoreKind,
  type FieldStoreMapping,
  fieldTypeToStore,
  fieldTypeToStoreType,
  type StoreType,
} from './field-store-map.js'
export { flattenFieldSetData } from './storage-flatten.js'
export {
  extractFlattenedFieldValue,
  type RestoreResult,
  restoreFieldSetData,
} from './storage-restore.js'
export { resolveStoreTypes } from './storage-utils.js'
export { type ColumnDef, storeColumnManifest, storeTableNames } from './store-manifest.js'
export type { FlattenedFieldValue, UnifiedFieldValue } from './storage-row-types.js'
