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

/**
 * Detect a raw (storage-shape) document vs a shaped `ClientDocument` vs a
 * plain object. Raw docs carry `document_id` + `fields` and have NOT yet
 * been through `shapeDocument` (no `versionId`).
 */
function isRawDocument(v: unknown): v is Record<string, any> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, any>
  return typeof o.document_id === 'string' && typeof o.fields === 'object' && !('versionId' in o)
}

/**
 * After `populateDocuments` replaces relation leaves with raw
 * storage-shape documents, walk the tree and convert each one to a
 * `ClientDocument` in place. Preserves reference equality for
 * non-document values so stubs (`_resolved: false`, `_cycle: true`) and
 * rich-text blobs are not rewritten.
 *
 * Call on `shaped.fields` after the top-level doc has already been
 * shaped. The function mutates arrays in place (replacing populated
 * entries) and returns the possibly-rewritten value for scalar inputs.
 */
export function shapePopulatedInPlace(value: unknown): unknown {
  if (value == null) return value
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = shapePopulatedInPlace(value[i])
    }
    return value
  }
  if (typeof value !== 'object') return value

  if (isRawDocument(value)) {
    const shaped = shapeDocument(value)
    shaped.fields = shapePopulatedInPlace(shaped.fields) as Record<string, any>
    return shaped
  }

  const obj = value as Record<string, any>
  for (const k of Object.keys(obj)) {
    obj[k] = shapePopulatedInPlace(obj[k])
  }
  return obj
}
