/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `buildSearchDocument` — the document-grain assembler for the
 * `SearchProvider` seam. Walks a collection's role-based `search` config
 * against one locale-resolved document and emits a single, type-enriched
 * `SearchDocument` for a driver to index. See
 * `docs/05-reading-and-delivery/07-search.md`.
 *
 * Role-based and explicit: only the fields named in `search.{body,facets,
 * filters}` are projected — nothing is auto-pulled, so unindexed content
 * never leaks into the index. Core derives each field's `SearchFieldType`
 * from the schema (the "type enrichment") so a driver can map it onto its
 * own index without re-inspecting the collection definition.
 *
 * Pure and synchronous, like `documentToMarkdown`: the rich-text plain-text
 * extractor is the editor-agnostic `toText` seam passed via options, and
 * relation targets are resolved through a caller-supplied definition
 * resolver — no globals, no DB reads. The caller is responsible for handing
 * in a document whose `facets` relation fields are already populated (depth
 * 1) with the target's identity + counter fields.
 *
 * `search.{facets,filters}` name **top-level** fields. `search.body` may name
 * a top-level field of any kind: scalar / `richText` leaves index directly,
 * and container fields (`blocks` / `array` / `group`) are walked recursively —
 * every nested `richText` and text (`text` / `textArea`) leaf is flattened and
 * concatenated into one searchable body string. Nested non-text leaves
 * (`select`, `relation`, numbers, booleans, dates, files) are skipped so block
 * configuration never pollutes the index — the same "content, not
 * configuration" rule the markdown assembler follows.
 */

import {
  type CollectionDefinition,
  type Field,
  type FieldSet,
  isArrayField,
  isBlocksField,
  isGroupField,
  type RichTextToTextFn,
  type SearchDocument,
  type SearchFacetValue,
  type SearchField,
  type SearchFieldDecl,
  type SearchFieldType,
} from '../@types/index.js'
import { resolveIdentityField } from './populate.js'

/** A locale-resolved document fed to the assembler — one locale's view. */
export interface SearchSourceDocument {
  /** Stable document id (shared across versions and locales). */
  documentId: string
  /** Content locale this view represents. */
  locale: string
  /** Lifecycle status of the indexed version. */
  status: string
  /** URL path, or null when the collection has none. */
  path?: string | null
  /**
   * Locale-resolved, camelCase field data (the `ClientDocument.fields`
   * shape). Relation fields named in `search.facets` must be populated.
   */
  fields: Record<string, any>
  /** Timestamp of the indexed version. */
  updatedAt?: Date | string
}

export interface BuildSearchDocumentOptions {
  /**
   * Rich-text plain-text extractor (`ServerConfig.fields.richText.toText`).
   * Required for `richText` fields named in `search.body`; without it those
   * fields are skipped.
   */
  richTextToText?: RichTextToTextFn
  /**
   * Resolve a target collection definition by path — used to find a facet
   * target's identity field (the term) and `counter` field (the id).
   */
  resolveTargetDefinition?: (collectionPath: string) => CollectionDefinition | null
  /** Content locale, for defensive locale-envelope resolution. */
  locale?: string
}

/**
 * Assemble one type-enriched `SearchDocument` from a locale-resolved
 * document and its collection's role-based `search` config.
 */
/**
 * Resolve the zone set a collection indexes into, or `null` when the
 * collection doesn't opt into search at all. A collection with a `search`
 * config but no explicit `zones` belongs to a single implicit zone equal to
 * its own path. Shared by the assembler (below) and the client's
 * cross-collection `search({ zone })` membership check so the two can't
 * drift.
 */
export function resolveSearchZones(definition: CollectionDefinition): string[] | null {
  const search = definition.search
  if (search == null) return null
  return search.zones != null && search.zones.length > 0 ? search.zones : [definition.path]
}

export function buildSearchDocument(
  doc: SearchSourceDocument,
  definition: CollectionDefinition,
  options: BuildSearchDocumentOptions = {}
): SearchDocument {
  const locale = options.locale ?? doc.locale
  const search = definition.search ?? {}
  const fieldsData = doc.fields ?? {}

  const title =
    stringValue(resolveLocalized(fieldsData[resolveIdentityField(definition) ?? ''], locale)) ?? ''

  const zones = resolveSearchZones(definition) ?? [definition.path]

  const fields: SearchField[] = []

  // --- body: searchable text -------------------------------------------------
  for (const decl of search.body ?? []) {
    const name = declName(decl)
    const field = definition.fields.find((f) => f.name === name)
    if (field == null) continue

    const value = collectBodyText(field, fieldsData[name], definition.path, locale, options)
    if (value != null) {
      fields.push(withBoost({ name, type: 'text', role: 'body', value }, decl))
    }
  }

  // --- facets: controlled-vocabulary references ------------------------------
  for (const decl of search.facets ?? []) {
    const name = declName(decl)
    const field = definition.fields.find((f) => f.name === name)
    if (field == null || field.type !== 'relation') continue

    const targetPath = (field as { targetCollection?: string }).targetCollection
    const targetDef = targetPath ? (options.resolveTargetDefinition?.(targetPath) ?? null) : null
    const termField = targetDef ? resolveIdentityField(targetDef) : undefined
    const idField = targetDef?.fields.find((f) => f.type === 'counter')?.name

    const facetValues = toEnvelopeArray(fieldsData[name])
      .map((env) => extractFacetValue(env, termField, idField, locale))
      .filter((v): v is SearchFacetValue => v != null)

    if (facetValues.length > 0) {
      fields.push(withBoost({ name, type: 'facet', role: 'facet', value: facetValues }, decl))
    }
  }

  // --- filters: scalar projections for filtering / sorting -------------------
  for (const name of search.filters ?? []) {
    const field = definition.fields.find((f) => f.name === name)
    if (field == null) continue
    const type = filterType(field.type)
    const value = coerceFilterValue(resolveLocalized(fieldsData[name], locale), type)
    if (value != null) {
      fields.push({ name, type, role: 'filter', value })
    }
  }

  return {
    collectionPath: definition.path,
    documentId: doc.documentId,
    locale,
    status: doc.status,
    zones,
    title,
    path: doc.path ?? null,
    fields,
    updatedAt: dateValue(doc.updatedAt) ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function declName(decl: SearchFieldDecl): string {
  return typeof decl === 'string' ? decl : decl.field
}

function withBoost(field: SearchField, decl: SearchFieldDecl): SearchField {
  const boost = typeof decl === 'string' ? undefined : decl.boost
  return boost != null ? { ...field, boost } : field
}

/** Text-bearing scalar leaves collected when walking into a container field. */
const TEXT_LEAF_TYPES = new Set(['text', 'textArea'])

/**
 * Resolve a single `search.body` field to its searchable text. A scalar /
 * `richText` leaf indexes directly (preserving the original top-level
 * behaviour); a container (`group` / `array` / `blocks`) is walked
 * recursively, flattening every nested text leaf into one string.
 */
function collectBodyText(
  field: Field,
  rawValue: unknown,
  collectionPath: string,
  locale: string | undefined,
  options: BuildSearchDocumentOptions
): string | null {
  const value = resolveLocalized(rawValue, locale)

  if (isGroupField(field) || isArrayField(field) || isBlocksField(field)) {
    return collectContainerText(field, value, collectionPath, locale, options)
  }

  return collectLeafText(field, value, collectionPath, options, /* permissive */ true)
}

/** Walk a container field, concatenating the text of its nested leaves. */
function collectContainerText(
  field: Field,
  value: unknown,
  collectionPath: string,
  locale: string | undefined,
  options: BuildSearchDocumentOptions
): string | null {
  if (isGroupField(field)) {
    return collectFieldSetText(field.fields, asRecord(value), collectionPath, locale, options)
  }

  if (isArrayField(field)) {
    if (!Array.isArray(value)) return null
    return joinTexts(
      value.map((item) =>
        collectFieldSetText(field.fields, asRecord(item), collectionPath, locale, options)
      )
    )
  }

  // blocks: resolve each item's block definition by `_type`, then walk it.
  if (!isBlocksField(field) || !Array.isArray(value)) return null
  const parts: (string | null)[] = []
  for (const item of value) {
    const record = asRecord(item)
    const block = field.blocks.find((b) => b.blockType === record._type)
    if (block == null) continue
    parts.push(collectFieldSetText(block.fields, record, collectionPath, locale, options))
  }
  return joinTexts(parts)
}

/** Collect text from every text-bearing leaf in a field set (one container level). */
function collectFieldSetText(
  fields: FieldSet,
  data: Record<string, any>,
  collectionPath: string,
  locale: string | undefined,
  options: BuildSearchDocumentOptions
): string | null {
  const parts: (string | null)[] = []
  for (const field of fields) {
    const value = resolveLocalized(data?.[field.name], locale)
    if (isGroupField(field) || isArrayField(field) || isBlocksField(field)) {
      parts.push(collectContainerText(field, value, collectionPath, locale, options))
    } else {
      // Nested leaves: only text-bearing types contribute — skip configuration
      // (select, relation, numbers, booleans, dates, files).
      parts.push(collectLeafText(field, value, collectionPath, options, /* permissive */ false))
    }
  }
  return joinTexts(parts)
}

/**
 * Extract text from a single leaf field. `richText` flows through the `toText`
 * seam. For other scalars, `permissive` distinguishes a field the implementor
 * named directly in `search.body` (index any scalar value, as before) from a
 * leaf reached by walking into a container (restricted to text/textArea so
 * block configuration values never leak into the index).
 */
function collectLeafText(
  field: Field,
  value: unknown,
  collectionPath: string,
  options: BuildSearchDocumentOptions,
  permissive: boolean
): string | null {
  if (field.type === 'richText') {
    return options.richTextToText
      ? nonEmpty(options.richTextToText({ value, fieldPath: field.name, collectionPath }))
      : null
  }
  if (permissive || TEXT_LEAF_TYPES.has(field.type)) {
    return stringValue(value)
  }
  return null
}

/** Join non-empty text parts with newlines, or null when there is nothing. */
function joinTexts(parts: (string | null | undefined)[]): string | null {
  const filtered = parts.filter((p): p is string => p != null && p.length > 0)
  return filtered.length > 0 ? filtered.join('\n') : null
}

/** A populated single relation or array of relations → array of envelopes. */
function toEnvelopeArray(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter((v) => v != null)
  if (value != null && typeof value === 'object') return [value as Record<string, any>]
  return []
}

function extractFacetValue(
  envelope: Record<string, any>,
  termField: string | undefined,
  idField: string | undefined,
  locale: string
): SearchFacetValue | null {
  const target = asRecord(envelope.document)
  const targetFields = asRecord(target.fields)
  const term = termField ? stringValue(resolveLocalized(targetFields[termField], locale)) : null
  if (term == null) return null

  // Prefer the target's stable counter id (the aggregator's reporting key);
  // fall back to its document id when the vocabulary has no counter field.
  const rawId = idField != null ? targetFields[idField] : undefined
  const id =
    typeof rawId === 'number' || typeof rawId === 'string'
      ? rawId
      : (stringValue(target.documentId ?? target.id) ?? term)

  return { id, term }
}

/** Map a collection field type to the filter-side `SearchFieldType`. */
function filterType(fieldType: string): SearchFieldType {
  switch (fieldType) {
    case 'integer':
    case 'counter':
      return 'integer'
    case 'float':
    case 'decimal':
      return 'float'
    case 'boolean':
    case 'checkbox':
      return 'boolean'
    case 'date':
    case 'time':
    case 'datetime':
      return 'datetime'
    default:
      return 'keyword'
  }
}

function coerceFilterValue(
  value: unknown,
  type: SearchFieldType
): string | number | boolean | null {
  if (value == null) return null
  switch (type) {
    case 'integer':
    case 'float': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? n : null
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null
    case 'datetime':
      return dateValue(value)
    default:
      return stringValue(value)
  }
}

/**
 * Locale-scoped reads deliver flat values; `locale: 'all'` reads deliver
 * `{ en: …, fr: … }` envelopes. Pick the requested locale (or the first
 * available) when an envelope sneaks through.
 */
function resolveLocalized(value: unknown, locale?: string): unknown {
  if (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    const localeLike = keys.length > 0 && keys.every((k) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(k))
    if (localeLike) {
      if (locale && locale in record) return record[locale]
      return record[keys[0] as string]
    }
  }
  return value
}

function asRecord(value: unknown): Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

function nonEmpty(value: string | null | undefined): string | null {
  return value != null && value.trim().length > 0 ? value : null
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null
  if (typeof value === 'number') return String(value)
  return null
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}
