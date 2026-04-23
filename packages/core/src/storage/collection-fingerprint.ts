/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

// Web Crypto (`globalThis.crypto.subtle`) works identically in Node 20+
// and every modern browser. Using it here — instead of `node:crypto` —
// keeps this module free of Node built-ins so it can sit in the static
// module graph walked by client bundlers without being externalised.

import type {
  Block,
  CollectionDefinition,
  Field,
  UploadConfig,
  WorkflowConfig,
} from '../@types/index.js'

// Reasoning: see `docs/analysis` discussions on collection versioning. The
// fingerprint is intentionally narrow — it's a hash of the data shape that
// matters for read-back migration, NOT of every field in the definition.
// Cosmetic changes (labels, admin metadata, search config) must not churn
// the version, because the version is written into every document row and
// will anchor the Phase-2 history table.

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

type CanonicalField = {
  name: string
  type: string
  optional: boolean
  localized: boolean
  fields?: CanonicalField[]
  blocks?: { blockType: string; fields: CanonicalField[] }[]
  options?: { value: string }[]
  targetCollection?: string
  displayField?: string
  mode?: string
  validation?: Record<string, unknown>
}

function canonicalField(field: Field): CanonicalField {
  const base: CanonicalField = {
    name: field.name,
    type: field.type,
    optional: field.optional === true,
    localized: (field as { localized?: boolean }).localized === true,
  }

  switch (field.type) {
    case 'group':
    case 'array':
      base.fields = field.fields.map(canonicalField)
      if (field.type === 'array' && field.validation) {
        base.validation = sortedShallow(field.validation as Record<string, unknown>)
      }
      return base

    case 'blocks':
      base.blocks = field.blocks.map((b: Block) => ({
        blockType: b.blockType,
        fields: b.fields.map(canonicalField),
      }))
      return base

    case 'select':
      base.options = field.options.map((o) => ({ value: o.value }))
      return base

    case 'relation':
      base.targetCollection = field.targetCollection
      if (field.displayField !== undefined) base.displayField = field.displayField
      return base

    case 'datetime':
      if (field.mode !== undefined) base.mode = field.mode
      return base

    case 'text':
    case 'textArea':
    case 'richText':
    case 'float':
    case 'integer':
      if (field.validation) {
        base.validation = sortedShallow(field.validation as Record<string, unknown>)
      }
      return base

    default:
      return base
  }
}

function canonicalWorkflow(w: WorkflowConfig): Record<string, unknown> {
  return {
    // Status names only — labels and verbs are presentation.
    statuses: w.statuses.map((s) => ({ name: s.name })),
    ...(w.defaultStatus !== undefined ? { defaultStatus: w.defaultStatus } : {}),
  }
}

function canonicalUpload(u: UploadConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (u.mimeTypes !== undefined) out.mimeTypes = [...u.mimeTypes].sort()
  if (u.maxFileSize !== undefined) out.maxFileSize = u.maxFileSize
  if (u.sizes !== undefined) {
    out.sizes = u.sizes
      .map((s) => ({
        name: s.name,
        ...(s.width !== undefined ? { width: s.width } : {}),
        ...(s.height !== undefined ? { height: s.height } : {}),
        ...(s.fit !== undefined ? { fit: s.fit } : {}),
        ...(s.format !== undefined ? { format: s.format } : {}),
        ...(s.quality !== undefined ? { quality: s.quality } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return out
}

function sortedShallow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key]
    if (v === undefined || typeof v === 'function') continue
    out[key] = v
  }
  return out
}

function canonicalCollection(def: CollectionDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: def.path,
    fields: def.fields.map(canonicalField),
  }
  if (def.workflow) out.workflow = canonicalWorkflow(def.workflow)
  if (def.upload) out.upload = canonicalUpload(def.upload)
  if (def.useAsPath !== undefined) out.useAsPath = def.useAsPath
  if (def.useAsTitle !== undefined) out.useAsTitle = def.useAsTitle
  return out
}

// ---------------------------------------------------------------------------
// Deterministic serialisation
// ---------------------------------------------------------------------------

// Recursive key-sorted JSON stringify. Skips `undefined` and functions so the
// presence of hooks / handler callbacks cannot change the output. Arrays
// preserve order (order is meaningful for fields, blocks, statuses).
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'undefined' || typeof value === 'function') return 'null'

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
      .sort()
    const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')
    return `{${body}}`
  }

  return 'null'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 fingerprint of the data-shape-relevant
 * portion of a `CollectionDefinition`. Two definitions that differ only in
 * cosmetic fields (labels, hooks, admin/search/showStats metadata, helpText,
 * placeholders) produce the same fingerprint. Adding or removing a field,
 * changing a field type, renaming a block variant, altering workflow statuses,
 * or changing a relation target all produce a different fingerprint.
 *
 * Async because `crypto.subtle.digest` is async on every platform. Returned
 * as a lowercase hex string (64 characters).
 */
export async function fingerprintCollection(def: CollectionDefinition): Promise<string> {
  const canonical = canonicalCollection(def)
  const serialised = stableStringify(canonical)
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialised))
  return bytesToHex(new Uint8Array(buffer))
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}
