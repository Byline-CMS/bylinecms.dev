/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Upload Executor
 *
 * Handles batch execution of pending file uploads at form submission time.
 * This enables "deferred uploads" — files are selected/previewed immediately
 * but only uploaded when the user clicks Save.
 */

import type { Field, StoredFileValue, UploadConfig } from '@byline/core'
import { type PathSegment, parseInstancePath } from '@byline/core'

import { get as getNestedValue } from './nested-path'
import type { UploadFieldFn } from '../fields/field-services-types'
import type { PendingUpload } from './form-context'

export interface UploadResult {
  fieldPath: string
  success: boolean
  storedFile?: StoredFileValue
  error?: string
}

export interface ExecuteUploadsResult {
  /** All upload results (both successful and failed) */
  results: UploadResult[]
  /** Map of field path to StoredFileValue for successful uploads */
  successful: Map<string, StoredFileValue>
  /** Map of field path to error message for failed uploads */
  errors: Map<string, string>
  /** Whether all uploads succeeded */
  allSucceeded: boolean
}

/**
 * Optional document context threaded from the form renderer so upload
 * requests carry the state that server-side `beforeStore` / `afterStore`
 * hooks need (see `UploadConfig.context` in `@byline/core`).
 */
export interface UploadExecutionContext {
  /**
   * The persisted document id (edit mode). Posted as `documentId` on every
   * upload request; omitted while the document is unsaved (create mode).
   */
  documentId?: string
  /**
   * The collection's schema fields — used to locate each upload field's
   * `upload.context` declaration by walking the pending upload's field path.
   */
  fields?: readonly Field[]
  /**
   * Snapshot accessor for the live form values, resolved lazily per upload
   * so context reflects the state at the moment the request is built.
   */
  getFormValues?: () => Record<string, any>
}

/**
 * Execute all pending uploads sequentially.
 * Returns a result object with successful uploads and any errors.
 *
 * @param pendingUploads - Map of field path to PendingUpload
 * @param uploadField - Host-provided upload transport (resolved via
 *                         `useBylineFieldServices()` in the calling React tree)
 * @param executionContext - Optional document/form context appended to each
 *                         upload request (documentId, `upload.context` values)
 * @returns Promise resolving to ExecuteUploadsResult
 */
export async function executeUploads(
  pendingUploads: Map<string, PendingUpload>,
  uploadField: UploadFieldFn,
  executionContext?: UploadExecutionContext
): Promise<ExecuteUploadsResult> {
  const results: UploadResult[] = []
  const successful = new Map<string, StoredFileValue>()
  const errors = new Map<string, string>()

  for (const [fieldPath, upload] of pendingUploads.entries()) {
    const formData = buildUploadFormData(fieldPath, upload, executionContext)

    try {
      // Pass createDocument=false — we're uploading for an embedded field,
      // the form's save action handles document creation/update.
      const result = await uploadField(upload.collectionPath, formData, false)

      results.push({
        fieldPath,
        success: true,
        storedFile: result.storedFile,
      })
      successful.set(fieldPath, result.storedFile)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      results.push({
        fieldPath,
        success: false,
        error: message,
      })
      errors.set(fieldPath, message)
    }
  }

  return {
    results,
    successful,
    errors,
    allSucceeded: errors.size === 0,
  }
}

/**
 * Compose the multipart body for one pending upload.
 *
 * Beyond the file itself, the request carries:
 *   - `field`     — leaf name of the upload-capable field (server-side
 *                   resolver matches upload fields by leaf name at any
 *                   nesting depth, so leaf names must be unique among a
 *                   collection's upload-capable fields).
 *   - `fieldPath` — the full form path (e.g.
 *                   `files[2].filesGroup.publicationFile`), so hooks can
 *                   distinguish array items.
 *   - `documentId` — the persisted document id (edit mode only).
 *   - one entry per resolved `upload.context` path (see
 *     `UploadConfig.context` in `@byline/core` for path semantics and
 *     serialisation rules).
 */
function buildUploadFormData(
  fieldPath: string,
  upload: PendingUpload,
  executionContext?: UploadExecutionContext
): FormData {
  const formData = new FormData()
  formData.append('file', upload.file)
  // Tell the server which upload-capable field this file belongs to.
  // With per-field upload config a collection can have multiple
  // image/file fields, each with its own constraints; the server's
  // unique-default fallback covers the single-field case but rejects
  // multi-field collections without an explicit selector.
  formData.append('field', uploadFieldName(fieldPath))
  formData.append('fieldPath', fieldPath)

  if (executionContext?.documentId) {
    formData.append('documentId', executionContext.documentId)
  }

  // Resolved once per upload, before locating the field: a `blocks` hop in
  // the path can only be resolved by reading the addressed item's `_type`.
  const formValues = executionContext?.getFormValues?.()

  const contextPaths =
    executionContext?.fields != null
      ? findUploadFieldByPath(executionContext.fields, fieldPath, formValues)?.context
      : undefined

  if (contextPaths && contextPaths.length > 0 && formValues) {
    for (const contextPath of contextPaths) {
      const resolvedPath = resolveContextPath(fieldPath, contextPath)
      if (resolvedPath === undefined) continue
      const value = resolvedPath === '' ? formValues : getNestedValue(formValues, resolvedPath)
      const serialized = serializeContextValue(value)
      if (serialized === undefined) continue
      formData.append(leafName(contextPath), serialized)
    }
  }

  return formData
}

/**
 * Extract the leaf field name from a `fieldPath`. Top-level upload
 * fields (`'image'`, `'avatar'`) pass through unchanged; nested paths
 * (`'files[0].filesGroup.publicationFile'`) reduce to their last
 * segment. The server-side resolver walks the schema recursively and
 * matches upload fields by leaf name at any nesting depth, so leaf
 * names must be unique among a collection's upload-capable fields.
 */
function uploadFieldName(fieldPath: string): string {
  const dot = fieldPath.lastIndexOf('.')
  return dot === -1 ? fieldPath : fieldPath.slice(dot + 1)
}

/** Leaf segment of a context path: `'../a.b'` → `'b'`, `'/x'` → `'x'`. */
function leafName(contextPath: string): string {
  const segments = contextPath.split('/').pop() ?? contextPath
  const dot = segments.lastIndexOf('.')
  return dot === -1 ? segments : segments.slice(dot + 1)
}

/**
 * Resolve an `upload.context` path declaration against the upload field's
 * position in the form, filesystem-style. The upload field is treated as a
 * "file" living in the directory formed by its containing scope:
 *
 *   fieldPath `files[2].filesGroup.publicationFile` → scope
 *   `['files[2]', 'filesGroup']`
 *
 *   - `'language'` / `'./language'` → `files[2].filesGroup.language`
 *   - `'../label'`                  → `files[2].label`
 *   - `'/serialNumber'`             → `serialNumber` (document root)
 *
 * Returns the dotted form path to read, `''` for the form root itself, or
 * `undefined` when `../` climbs past the root (declaration bug — the value
 * is skipped rather than mis-resolved).
 */
function resolveContextPath(fieldPath: string, contextPath: string): string | undefined {
  // Root-absolute: strip the slash, done.
  if (contextPath.startsWith('/')) {
    return contextPath.slice(1)
  }

  // Scope = the upload field's containing segments (dot-split keeps array
  // selectors attached to their segment: `files[id=x]` stays one hop).
  // This relies on every dotted form-path segment being a real data scope. If
  // the grammar ever adds descriptive/non-navigating segments, classify and
  // remove them before counting `..` hops rather than changing parent scope.
  const scope = fieldPath.split('.')
  scope.pop() // drop the upload field's own leaf segment

  const parts = contextPath.split('/')
  const leaf = parts.pop() ?? ''
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (scope.length === 0) return undefined
      scope.pop()
      continue
    }
    // A directory-style intermediate segment (`a/b`) descends.
    scope.push(part)
  }

  return scope.length === 0 ? leaf : `${scope.join('.')}${leaf ? `.${leaf}` : ''}`
}

/**
 * Serialise a resolved form value for the multipart `fields` bag.
 * See `UploadConfig.context` for the contract.
 */
function serializeContextValue(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Relation envelope → its target document id.
  if (isRelationEnvelope(value)) return value.targetDocumentId
  // hasMany relation → comma-joined ids.
  if (Array.isArray(value) && value.length > 0 && value.every(isRelationEnvelope)) {
    return value.map((v) => v.targetDocumentId).join(',')
  }
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function isRelationEnvelope(value: unknown): value is { targetDocumentId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { targetDocumentId?: unknown }).targetDocumentId === 'string'
  )
}

/**
 * Locate the upload-capable `image | file` schema field addressed by a form
 * field path, walking `group` / `array` / `blocks` structures.
 *
 * The path is an *instance* path (`content[1].gallery[0].poster`), so it
 * carries no block type — a block item's type lives on the item itself, as
 * `_type`. Passing `formValues` therefore lets a `blocks` hop be resolved
 * exactly: read the addressed item, take its `_type`, descend into that
 * block. Without form values the block type is genuinely unknowable from the
 * path, so every block is tried and the result is accepted only when exactly
 * one resolves — ambiguity returns `undefined` rather than a guess.
 */
function findUploadFieldByPath(
  fields: readonly Field[],
  fieldPath: string,
  formValues?: Record<string, any>
): UploadConfig | undefined {
  const parsed = parseInstancePath(fieldPath)
  if (!parsed.ok) return undefined
  return resolveUploadConfig(fields, parsed.segments, formValues)
}

/** Select the item an index / id segment addresses, when data is available. */
function selectItem(value: unknown, segment: PathSegment): unknown {
  if (!Array.isArray(value)) return undefined
  if (segment.kind === 'index') return value[segment.index]
  if (segment.kind === 'id') {
    return value.find((item) => (item as { _id?: unknown } | null)?._id === segment.id)
  }
  return undefined
}

/**
 * Walk instance-path segments against the schema, carrying the corresponding
 * slice of form data alongside so `blocks` hops can read `_type`.
 */
function resolveUploadConfig(
  fields: readonly Field[],
  segments: readonly PathSegment[],
  value: unknown
): UploadConfig | undefined {
  const head = segments[0]
  if (head == null || head.kind !== 'field') return undefined

  const field = fields.find((candidate) => candidate.name === head.name)
  if (field == null) return undefined

  const fieldValue = (value as Record<string, unknown> | undefined)?.[head.name]
  const rest = segments.slice(1)

  if (rest.length === 0) {
    return field.type === 'image' || field.type === 'file' ? field.upload : undefined
  }

  if (field.type === 'group') {
    return resolveUploadConfig(field.fields, rest, fieldValue)
  }

  if (field.type === 'array') {
    // An item selector may be absent when the caller addresses the array's
    // child declaration rather than one item; the child fields are the same.
    const selector = rest[0]
    if (selector?.kind === 'index' || selector?.kind === 'id') {
      return resolveUploadConfig(field.fields, rest.slice(1), selectItem(fieldValue, selector))
    }
    return resolveUploadConfig(field.fields, rest, undefined)
  }

  if (field.type === 'blocks') {
    const selector = rest[0]
    const remainder = selector?.kind === 'index' || selector?.kind === 'id' ? rest.slice(1) : rest
    const item =
      selector?.kind === 'index' || selector?.kind === 'id'
        ? selectItem(fieldValue, selector)
        : undefined

    const blockType = (item as { _type?: unknown } | undefined)?._type
    if (typeof blockType === 'string') {
      const block = field.blocks.find((candidate) => candidate.blockType === blockType)
      return block == null ? undefined : resolveUploadConfig(block.fields, remainder, item)
    }

    // No data to disambiguate. Try every block and accept a unique answer;
    // two matches mean the path genuinely does not identify one declaration.
    let found: UploadConfig | undefined
    let matches = 0
    for (const block of field.blocks) {
      const result = resolveUploadConfig(block.fields, remainder, undefined)
      if (result !== undefined) {
        matches += 1
        found = result
      }
    }
    return matches === 1 ? found : undefined
  }

  return undefined
}

/**
 * Progress callback type for upload execution with progress tracking.
 */
export type UploadProgressCallback = (info: {
  current: number
  total: number
  fieldPath: string
  status: 'uploading' | 'done' | 'error'
}) => void

/**
 * Execute uploads with progress callbacks.
 * Useful for showing upload progress in the UI.
 */
export async function executeUploadsWithProgress(
  pendingUploads: Map<string, PendingUpload>,
  uploadField: UploadFieldFn,
  onProgress?: UploadProgressCallback,
  executionContext?: UploadExecutionContext
): Promise<ExecuteUploadsResult> {
  const results: UploadResult[] = []
  const successful = new Map<string, StoredFileValue>()
  const errors = new Map<string, string>()

  const entries = Array.from(pendingUploads.entries())
  const total = entries.length

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    const [fieldPath, upload] = entry

    onProgress?.({
      current: i + 1,
      total,
      fieldPath,
      status: 'uploading',
    })

    const formData = buildUploadFormData(fieldPath, upload, executionContext)

    try {
      const result = await uploadField(upload.collectionPath, formData, false)

      results.push({
        fieldPath,
        success: true,
        storedFile: result.storedFile,
      })
      successful.set(fieldPath, result.storedFile)

      onProgress?.({
        current: i + 1,
        total,
        fieldPath,
        status: 'done',
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      results.push({
        fieldPath,
        success: false,
        error: message,
      })
      errors.set(fieldPath, message)

      onProgress?.({
        current: i + 1,
        total,
        fieldPath,
        status: 'error',
      })
    }
  }

  return {
    results,
    successful,
    errors,
    allSucceeded: errors.size === 0,
  }
}
