/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * FileUploadField
 *
 * Generic drag-and-drop / click-to-browse file picker that prepares a file for
 * upload. Mirrors `ImageUploadField` but without image-specific validation or
 * dimension extraction. The actual upload is deferred until form submission —
 * this component stores the file in the form context's pending uploads and
 * emits a placeholder StoredFileValue with a blob URL (used by the form
 * orchestrator for cleanup; not shown to the user).
 */

import type { ChangeEvent, DragEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

import {
  createPendingStoredFileValue,
  type FileField as FieldType,
  type PendingStoredFileValue,
  type StoredFileValue,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import cx from 'classnames'

import { useFormContext } from '../../forms/form-context'
import styles from './file-upload-field.module.css'

interface FileUploadFieldProps {
  field: FieldType
  /** Collection path used to build the upload URL (e.g. `'media'`). */
  collectionPath: string
  /** Field path in the form (e.g. `'attachment'` or `'content.0.attachment'`). */
  fieldPath: string
  /** Called with the PendingStoredFileValue for immediate UI update. */
  onUploaded: (value: StoredFileValue | PendingStoredFileValue) => void
  /** Optional `accept` MIME-type / extension string for the native file input. */
  accept?: string
}

type SelectionStatus = 'idle' | 'processing' | 'error'

export const FileUploadField = ({
  field: _field,
  collectionPath,
  fieldPath,
  onUploaded,
  accept,
}: FileUploadFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation('byline-admin')
  const [status, setStatus] = useState<SelectionStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const { addPendingUpload } = useFormContext()

  const handleFileSelected = useCallback(
    (file: File) => {
      setStatus('processing')
      setErrorMessage(null)

      // Blob URL is created so the form orchestrator can revoke it on cleanup
      // alongside image-field uploads; it isn't surfaced in the UI here.
      const previewUrl = URL.createObjectURL(file)

      const pendingValue = createPendingStoredFileValue(file, previewUrl)

      addPendingUpload(fieldPath, {
        file,
        previewUrl,
        collectionPath,
      })

      setStatus('idle')
      onUploaded(pendingValue)
    },
    [collectionPath, fieldPath, addPendingUpload, onUploaded]
  )

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

  const isProcessing = status === 'processing'

  return (
    <div className={cx('byline-field-file-upload', styles.root)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={cx('byline-field-file-upload-input', styles.input)}
        onChange={handleFileChange}
        disabled={isProcessing}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={t('fields.file.upload.zoneAriaLabel')}
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
          'byline-field-file-upload-zone',
          styles.zone,
          isDragOver &&
            !isProcessing && ['byline-field-file-upload-zone-active', styles['zone-active']],
          isProcessing && ['byline-field-file-upload-zone-busy', styles['zone-busy']]
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={cx('byline-field-file-upload-icon', styles.icon)}
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
        <span className={cx('byline-field-file-upload-label', styles.label)}>
          {t('fields.file.upload.label')}{' '}
          <span className={cx('byline-field-file-upload-action', styles.action)}>
            {t('fields.file.upload.browse')}
          </span>
        </span>
      </div>

      {status === 'error' && errorMessage && (
        <p className={cx('byline-field-file-upload-error', styles.error)} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
