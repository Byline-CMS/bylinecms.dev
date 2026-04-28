/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type ImageField as FieldType,
  isPendingStoredFileValue,
  type StoredFileValue,
} from '@byline/core'
import { ErrorText } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useFieldError, useFieldValue, useFormContext, useIsDirty } from '../../forms/form-context'
import { useFieldChangeHandler } from '../use-field-change-handler'
import styles from './image-field.module.css'
import { ImageUploadField } from './image-upload-field'

interface ImageFieldProps {
  field: FieldType
  /** Collection path required to call the /upload endpoint. */
  collectionPath?: string
  // Stored value is currently a plain object with file/image metadata
  // coming from the seed data / storage layer.
  value?: StoredFileValue | null
  defaultValue?: StoredFileValue | null
  onChange?: (value: StoredFileValue | null) => void
  path?: string
}

export const ImageField = ({
  field,
  collectionPath,
  value,
  defaultValue,
  onChange: _onChange,
  path,
}: ImageFieldProps) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<StoredFileValue | null | undefined>(fieldPath)
  const { removePendingUpload } = useFormContext()

  // Re-use the standard field change handler so patches are emitted correctly.
  const handleChange = useFieldChangeHandler(field, fieldPath)

  // When the field has been explicitly set (dirty), use the field value from
  // form state — even if it's null (user clicked Remove). Only fall back to
  // the prop / defaultValue when the field hasn't been touched yet.
  const incomingValue = isDirty
    ? (fieldValue ?? null)
    : (value ?? fieldValue ?? defaultValue ?? null)

  // Check if this is a pending upload (selected but not yet uploaded)
  const isPending = isPendingStoredFileValue(incomingValue)

  // Old placeholder check for backwards compatibility
  const isOldPlaceholder = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false
    const maybe = v as Partial<StoredFileValue>
    return maybe.storageProvider === 'placeholder' && maybe.storagePath === 'pending'
  }

  // Show upload widget only if no value or old placeholder
  const showUploadWidget = incomingValue == null || isOldPlaceholder(incomingValue)

  // Handle remove, including cleanup of pending uploads
  const handleRemove = () => {
    if (isPending) {
      removePendingUpload(fieldPath)
    }
    handleChange(null)
  }

  return (
    <div className={`byline-field-image ${field.name}`}>
      <div className={cx('byline-field-image-header', styles.header)}>
        <div>
          <div className={cx('byline-field-image-label', styles.label)}>
            {field.label ?? field.name}
            {field.optional ? '' : ' *'}
          </div>
          {field.helpText && (
            <div className={cx('byline-field-image-help', styles.help)}>{field.helpText}</div>
          )}
        </div>
        {/* Remove button — shown when an image is set (including pending) */}
        {!showUploadWidget && collectionPath && (
          <button
            type="button"
            className={cx('byline-field-image-remove', styles.remove)}
            onClick={handleRemove}
          >
            Remove
          </button>
        )}
      </div>

      {showUploadWidget ? (
        collectionPath ? (
          <ImageUploadField
            field={field}
            collectionPath={collectionPath}
            fieldPath={fieldPath}
            onUploaded={(uploaded) => {
              handleChange(uploaded)
            }}
          />
        ) : (
          <div className={cx('byline-field-image-empty', styles.empty)}>No image selected</div>
        )
      ) : (
        <div className={cx('byline-field-image-tile', styles.tile)}>
          {/* Preview */}
          {incomingValue?.storageUrl && (
            <div className={cx('byline-field-image-preview-wrap', styles['preview-wrap'])}>
              <img
                src={incomingValue.storageUrl}
                alt={incomingValue.originalFilename ?? incomingValue.filename}
                className={cx(
                  'byline-field-image-preview',
                  styles.preview,
                  incomingValue.mimeType === 'image/svg+xml' && [
                    'byline-field-image-preview-svg',
                    styles['preview-svg'],
                  ]
                )}
              />
              {/* Pending upload badge */}
              {isPending && (
                <div className={cx('byline-field-image-pending', styles.pending)}>
                  Pending upload
                </div>
              )}
            </div>
          )}
          {/* Metadata */}
          <div className={cx('byline-field-image-meta', styles.meta)}>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                Filename:
              </span>{' '}
              {incomingValue?.filename}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                Original:
              </span>{' '}
              {incomingValue?.originalFilename}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>Type:</span>{' '}
              {incomingValue?.mimeType}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>Size:</span>{' '}
              {incomingValue?.fileSize}
            </div>
            {isPending ? (
              <div>
                <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                  Status:
                </span>{' '}
                <span className={cx('byline-field-image-meta-pending', styles['meta-pending'])}>
                  Will upload on save
                </span>
              </div>
            ) : (
              <>
                <div>
                  <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                    Storage:
                  </span>{' '}
                  {incomingValue?.storageProvider}
                </div>
                {incomingValue?.imageWidth != null && (
                  <div>
                    <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                      Dimensions:
                    </span>{' '}
                    {incomingValue.imageWidth}
                    {incomingValue.imageHeight != null ? `×${incomingValue.imageHeight}` : ''}
                  </div>
                )}
                {incomingValue?.imageFormat != null && (
                  <div>
                    <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                      Format:
                    </span>{' '}
                    {incomingValue.imageFormat}
                  </div>
                )}
                <div>
                  <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                    Thumbnail:
                  </span>{' '}
                  {incomingValue?.thumbnailGenerated ? 'Generated' : 'Pending'}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
    </div>
  )
}
