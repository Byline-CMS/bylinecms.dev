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

import { useFieldError, useFieldValue, useFormContext, useIsDirty } from '../../forms/form-context'
import { useFieldChangeHandler } from '../use-field-change-handler'
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
  const _isDirty = useIsDirty(fieldPath)
  const isDirty = _isDirty
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
    <div className={`byline-image ${field.name}`}>
      <div className="flex items-baseline gap-2 mb-1">
        <div>
          <div className="text-sm font-medium text-gray-100">
            {field.label ?? field.name}
            {field.optional ? '' : ' *'}
          </div>
          {field.helpText && <div className="mt-0.5 text-xs text-gray-400">{field.helpText}</div>}
        </div>
        {/* Remove button — shown when an image is set (including pending) */}
        {!showUploadWidget && collectionPath && (
          <button
            type="button"
            className="text-xs text-red-500 hover:text-red-400 underline-offset-2 hover:underline"
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
          <div className="text-xs text-gray-500 italic">No image selected</div>
        )
      ) : (
        <div className="mt-1 flex gap-4 border border-primary-500 p-2 rounded-md">
          {/* Preview */}
          {incomingValue?.storageUrl && (
            <div className="relative">
              <img
                src={incomingValue.storageUrl}
                alt={incomingValue.originalFilename ?? incomingValue.filename}
                className={`rounded border border-gray-600 object-contain ${
                  incomingValue.mimeType === 'image/svg+xml'
                    ? 'w-[271px] h-[159px]'
                    : 'max-h-40 min-h-16 min-w-16'
                }`}
              />
              {/* Pending upload badge */}
              {isPending && (
                <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-600/90 text-yellow-100 text-[0.6rem] font-medium rounded">
                  Pending upload
                </div>
              )}
            </div>
          )}
          {/* Metadata */}
          <div className="text-xs text-gray-200 space-y-0.5">
            <div>
              <span className="font-semibold">Filename:</span> {incomingValue?.filename}
            </div>
            <div>
              <span className="font-semibold">Original:</span> {incomingValue?.originalFilename}
            </div>
            <div>
              <span className="font-semibold">Type:</span> {incomingValue?.mimeType}
            </div>
            <div>
              <span className="font-semibold">Size:</span> {incomingValue?.fileSize}
            </div>
            {isPending ? (
              <div>
                <span className="font-semibold">Status:</span>{' '}
                <span className="text-yellow-400">Will upload on save</span>
              </div>
            ) : (
              <>
                <div>
                  <span className="font-semibold">Storage:</span> {incomingValue?.storageProvider}
                </div>
                {incomingValue?.imageWidth != null && (
                  <div>
                    <span className="font-semibold">Dimensions:</span> {incomingValue.imageWidth}
                    {incomingValue.imageHeight != null ? `×${incomingValue.imageHeight}` : ''}
                  </div>
                )}
                {incomingValue?.imageFormat != null && (
                  <div>
                    <span className="font-semibold">Format:</span> {incomingValue.imageFormat}
                  </div>
                )}
                <div>
                  <span className="font-semibold">Thumbnail:</span>{' '}
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
