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

import { useFormContext } from '../../forms/form-context'
import styles from './image-upload-field.module.css'

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
        // SVGs without explicit width/height attrs (viewBox-only) report naturalWidth/Height = 0.
        // Skip dimensions when zero so they are stored as null (scalable, no fixed size).
        const w = img.naturalWidth
        const h = img.naturalHeight
        const dimensions = w > 0 && h > 0 ? { width: w, height: h } : undefined

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
    <div className={cx('byline-field-image-upload', styles.root)}>
      {/* Hidden native file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={cx('byline-field-image-upload-input', styles.input)}
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
          'byline-field-image-upload-zone',
          styles.zone,
          isDragOver &&
            !isProcessing && ['byline-field-image-upload-zone-active', styles['zone-active']],
          isProcessing && ['byline-field-image-upload-zone-busy', styles['zone-busy']]
        )}
      >
        {isProcessing ? (
          <>
            {/* Spinner */}
            <svg
              className={cx('byline-field-image-upload-spinner', styles.spinner)}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                style={{ opacity: 0.25 }}
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                style={{ opacity: 0.75 }}
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className={cx('byline-field-image-upload-label', styles.label)}>Processing…</span>
          </>
        ) : (
          <>
            {/* Upload icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={cx('byline-field-image-upload-icon', styles.icon)}
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
            <span className={cx('byline-field-image-upload-label', styles.label)}>
              Drop image here or{' '}
              <span className={cx('byline-field-image-upload-action', styles.action)}>browse</span>
            </span>
            <span className={cx('byline-field-image-upload-hint', styles.hint)}>
              JPEG, PNG, WebP, GIF, SVG, AVIF
            </span>
          </>
        )}
      </div>

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className={cx('byline-field-image-upload-error', styles.error)} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
