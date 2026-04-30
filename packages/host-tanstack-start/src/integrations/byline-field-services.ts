/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Host-side adapters that bind the webapp's TanStack Start server functions
 * to the framework-neutral `BylineFieldServices` contract consumed by
 * `@byline/ui` field/form components.
 *
 * Wired into the admin route once via `<BylineFieldServicesProvider>`. A
 * future Next.js host would ship its own adapter file and Provider; the
 * @byline/ui surface is unchanged.
 */

import type { BylineFieldServices, GetCollectionDocumentsFn, UploadDocumentFn } from '@byline/ui'

import { getCollectionDocuments as serverGetCollectionDocuments } from '../server-fns/collections/list.js'
import { uploadDocument as serverUploadDocument } from '../server-fns/collections/upload.js'

const getCollectionDocuments: GetCollectionDocumentsFn = ({ collection, params }) =>
  serverGetCollectionDocuments({
    data: { collection, params },
  }) as ReturnType<GetCollectionDocumentsFn>

const uploadDocument: UploadDocumentFn = (collection, formData, createDocument) =>
  serverUploadDocument(collection, formData, createDocument)

export const bylineFieldServices: BylineFieldServices = {
  getCollectionDocuments,
  uploadDocument,
}
