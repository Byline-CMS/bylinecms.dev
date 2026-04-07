/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ClientDocument } from './types.js'

/**
 * Shape an internal document (snake_case, storage layer format) into the
 * public ClientDocument format (camelCase).
 */
export function shapeDocument(raw: Record<string, any>): ClientDocument {
  return {
    id: raw.document_id ?? '',
    versionId: raw.document_version_id ?? '',
    path: raw.path ?? '',
    status: raw.status ?? '',
    createdAt: raw.created_at instanceof Date ? raw.created_at : new Date(raw.created_at ?? 0),
    updatedAt: raw.updated_at instanceof Date ? raw.updated_at : new Date(raw.updated_at ?? 0),
    fields: raw.fields ?? {},
  }
}
