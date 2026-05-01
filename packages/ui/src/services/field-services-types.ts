/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Framework-neutral function contracts that field/form components in
 * `@byline/ui` need from the host application. The host wires concrete
 * implementations via `BylineFieldServicesProvider` — typically thin
 * adapters around TanStack Start server functions, Next.js server
 * actions, or any other RPC-style transport.
 */

import type { StoredFileValue } from '@byline/core'

export interface CollectionListParams {
  page?: number
  page_size?: number
  order?: string
  desc?: boolean
  query?: string
  locale?: string
  status?: string
  fields?: string[]
}

export interface CollectionListDoc {
  id: string
  path?: string
  [field: string]: unknown
}

export interface CollectionListResponse {
  docs: CollectionListDoc[]
  meta: { totalPages?: number; [k: string]: unknown }
  included: { collection: { id: string; [k: string]: unknown } }
}

export type GetCollectionDocumentsFn = (input: {
  collection: string
  params: CollectionListParams
}) => Promise<CollectionListResponse>

export interface UploadedFileResult {
  documentId?: string
  documentVersionId?: string
  /**
   * The persisted file value, including the `variants` array with
   * `storagePath`, `storageUrl`, `width`, `height`, and `format` for each
   * generated derivative. Single source of truth — the legacy top-level
   * `variants: { name, url }[]` is gone.
   */
  storedFile: StoredFileValue
}

export type UploadFieldFn = (
  collection: string,
  formData: FormData,
  createDocument?: boolean
) => Promise<UploadedFileResult>

export interface BylineFieldServices {
  getCollectionDocuments: GetCollectionDocumentsFn
  uploadField: UploadFieldFn
}
