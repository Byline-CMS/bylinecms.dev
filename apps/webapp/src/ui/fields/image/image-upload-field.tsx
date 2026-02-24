/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * ImageUploadField
 *
 * A drag-and-drop / click-to-browse file picker that prepares an image for
 * upload. The actual upload is deferred until form submission — this component
 * stores the file in the form context's pending uploads and emits a placeholder
 * StoredFileValue with a blob URL for immediate preview.
 *
 * Prototype: no chunk upload, no resumable uploads, single file only.
 */

import type { ChangeEvent, DragEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

import {
  createPendingStoredFileValue,
  type ImageField as FieldType,
  type PendingStoredFileValue,
  type StoredFileValue,
} from '@byline/core'
import cx from 'classnames'

import { useFormContext } from '../form-context'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageUploadFieldProps {
  field: FieldType
  /** Collection path used to build the upload URL (e.g. `'media'`). */
  collectionPath: string
  /** Field path in the form (e.g. `'image'` or `'content.0.image'`). */
  fieldPath: string
  /** Called with the PendingStoredFileValue for immediate preview. */
  onUploaded: (value: StoredFileValue | PendingStoredFileValue) => void
  /** Optional accepted-file MIME types string for the native file input. */
  accept?: string
}

type SelectionStatus = 'idle' | 'processing' | 'error'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ImageUploadField = ({
  field: _field,
  collectionPath,
  fieldPath,
  onUploaded,
  accept = 'image/*',
}: ImageUploadFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<SelectionStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const { addPendingUpload } = useFormContext()

  // -------------------------------------------------------------------------
  // Core file selection logic (deferred upload)
  // -------------------------------------------------------------------------

  const handleFileSelected = useCallback(
    (file: File) => {
      setStatus('processing')
      setErrorMessage(null)

      // Basic client-side validation
      if (!file.type.startsWith('image/')) {
        setStatus('error')
        setErrorMessage('Please select an image file.')
        return
      }

      // Create a blob URL for immediate preview
      const previewUrl = URL.createObjectURL(file)

      // Extract image dimensions for the pending value
      const img = new Image()
      img.onload = () => {
        const dimensions = { width: img.naturalWidth, height: img.naturalHeight }

        // Create the pending stored file value
        const pendingValue = createPendingStoredFileValue(file, previewUrl, dimensions)

        // Register the pending upload in form context
        addPendingUpload(fieldPath, {
          file,
          previewUrl,
          collectionPath,
        })

        setStatus('idle')
        onUploaded(pendingValue)
      }

      img.onerror = () => {
        URL.revokeObjectURL(previewUrl)
        setStatus('error')
        setErrorMessage('Could not read image. Please try a different file.')
      }

      img.src = previewUrl
    },
    [collectionPath, fieldPath, addPendingUpload, onUploaded]
  )

  // -------------------------------------------------------------------------
  // File input
  // -------------------------------------------------------------------------

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFileSelected(file)
      // Reset so re-selecting the same file fires the event again.
      e.target.value = ''
    },
    [handleFileSelected]
  )

  const handleBrowseClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFileSelected(file)
    },
    [handleFileSelected]
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isProcessing = status === 'processing'

  return (
    <div className="mt-1">
      {/* Hidden native file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleFileChange}
        disabled={isProcessing}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload image — drag and drop or click to browse"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleBrowseClick()
          }
        }}
        className={cx(
          'flex flex-col items-center justify-center gap-2',
          'border-2 border-dashed rounded-lg px-4 py-6 text-center',
          'cursor-pointer select-none transition-colors duration-150',
          {
            'border-primary-400 bg-primary-900/20 text-primary-300': isDragOver && !isProcessing,
            'border-gray-600 hover:border-primary-500 hover:bg-primary-900/10 text-gray-400':
              !isDragOver && !isProcessing,
            'border-gray-700 bg-gray-800/50 text-gray-600 cursor-not-allowed': isProcessing,
          }
        )}
      >
        {isProcessing ? (
          <>
            {/* Spinner */}
            <svg
              className="animate-spin h-6 w-6 text-primary-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-xs font-medium">Processing…</span>
          </>
        ) : (
          <>
            {/* Upload icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 opacity-60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <span className="text-xs font-medium">
              Drop image here or{' '}
              <span className="text-primary-400 underline underline-offset-2">browse</span>
            </span>
            <span className="text-[0.65rem] text-gray-500">JPEG, PNG, WebP, GIF, SVG, AVIF</span>
          </>
        )}
      </div>

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="mt-1.5 text-xs text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
