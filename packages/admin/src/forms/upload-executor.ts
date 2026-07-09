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

import type { StoredFileValue } from '@byline/core'

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
 * Execute all pending uploads sequentially.
 * Returns a result object with successful uploads and any errors.
 *
 * @param pendingUploads - Map of field path to PendingUpload
 * @param uploadField - Host-provided upload transport (resolved via
 *                         `useBylineFieldServices()` in the calling React tree)
 * @returns Promise resolving to ExecuteUploadsResult
 */
export async function executeUploads(
  pendingUploads: Map<string, PendingUpload>,
  uploadField: UploadFieldFn
): Promise<ExecuteUploadsResult> {
  const results: UploadResult[] = []
  const successful = new Map<string, StoredFileValue>()
  const errors = new Map<string, string>()

  for (const [fieldPath, upload] of pendingUploads.entries()) {
    const formData = new FormData()
    formData.append('file', upload.file)
    // Tell the server which upload-capable field this file belongs to.
    // With per-field upload config a collection can have multiple
    // image/file fields, each with its own constraints; the server's
    // unique-default fallback covers the single-field case but rejects
    // multi-field collections without an explicit selector.
    formData.append('field', uploadFieldName(fieldPath))

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
  onProgress?: UploadProgressCallback
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

    const formData = new FormData()
    formData.append('file', upload.file)
    formData.append('field', uploadFieldName(fieldPath))

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
