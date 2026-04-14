/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ClientDocument } from './types.js'

/**
 * Coerce a storage-layer date value into a Date. Throws when the value is
 * missing — every document version row carries created_at/updated_at, so a
 * nullish value here indicates a malformed row (not a shaping concern).
 */
function toDate(value: unknown, fieldName: string): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') return new Date(value)
  throw new Error(`shapeDocument: missing or invalid ${fieldName}`)
}

/**
 * Shape an internal document (snake_case, storage layer format) into the
 * public ClientDocument format (camelCase). The generic `F` types the
 * `fields` property for callers that know their collection's shape.
 */
export function shapeDocument<F = Record<string, any>>(
  raw: Record<string, any>
): ClientDocument<F> {
  return {
    id: raw.document_id ?? '',
    versionId: raw.document_version_id ?? '',
    path: raw.path ?? '',
    status: raw.status ?? '',
    createdAt: toDate(raw.created_at, 'created_at'),
    updatedAt: toDate(raw.updated_at, 'updated_at'),
    fields: (raw.fields ?? {}) as F,
  }
}
