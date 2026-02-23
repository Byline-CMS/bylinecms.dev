/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { ImageField as FieldType, StoredFileValue } from '@byline/core'

import { useFieldError, useFieldValue, useIsDirty } from '../form-context'
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
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<StoredFileValue | null | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? null

  // Re-use the standard field change handler so patches are emitted correctly.
  const handleChange = useFieldChangeHandler(field, fieldPath)

  const isPlaceholderStoredFileValue = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false
    const maybe = v as Partial<StoredFileValue>
    return maybe.storage_provider === 'placeholder' && maybe.storage_path === 'pending'
  }

  const effectiveValue: StoredFileValue | null = isPlaceholderStoredFileValue(incomingValue)
    ? null
    : incomingValue

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-sm font-medium text-gray-100">
            {field.label ?? field.name}
            {field.required ? ' *' : ''}
          </div>
          {field.helpText && <div className="mt-0.5 text-xs text-gray-400">{field.helpText}</div>}
        </div>
        {/* Replace button — only shown when an image is already set */}
        {effectiveValue != null && collectionPath && (
          <button
            type="button"
            className="text-xs text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
            onClick={() => handleChange(null)}
          >
            Remove
          </button>
        )}
      </div>

      {effectiveValue == null ? (
        collectionPath ? (
          <ImageUploadField
            field={field}
            collectionPath={collectionPath}
            onUploaded={(uploaded) => {
              handleChange(uploaded)
            }}
          />
        ) : (
          <div className="text-xs text-gray-500 italic">No image selected</div>
        )
      ) : (
        <div className="mt-1 space-y-2 flex gap-4">
          {/* Preview */}
          {effectiveValue.storage_url && (
            <img
              src={effectiveValue.storage_url}
              alt={effectiveValue.original_filename ?? effectiveValue.filename}
              className="max-h-40 rounded border border-gray-600 object-contain"
            />
          )}
          {/* Metadata */}
          <div className="text-xs text-gray-200 space-y-0.5">
            <div>
              <span className="font-semibold">Filename:</span> {effectiveValue.filename}
            </div>
            <div>
              <span className="font-semibold">Original:</span> {effectiveValue.original_filename}
            </div>
            <div>
              <span className="font-semibold">Type:</span> {effectiveValue.mime_type}
            </div>
            <div>
              <span className="font-semibold">Size:</span> {effectiveValue.file_size}
            </div>
            <div>
              <span className="font-semibold">Storage:</span> {effectiveValue.storage_provider}
            </div>
            {effectiveValue.image_width != null && (
              <div>
                <span className="font-semibold">Dimensions:</span> {effectiveValue.image_width}
                {effectiveValue.image_height != null ? `×${effectiveValue.image_height}` : ''}
              </div>
            )}
            {effectiveValue.image_format != null && (
              <div>
                <span className="font-semibold">Format:</span> {effectiveValue.image_format}
              </div>
            )}
            <div>
              <span className="font-semibold">Thumbnail:</span>{' '}
              {effectiveValue.thumbnail_generated ? 'Generated' : 'Pending'}
            </div>
          </div>
          {/* Replace option */}
          {/* {collectionPath && (
            <ImageUploadField
              field={field}
              collectionPath={collectionPath}
              onUploaded={(uploaded) => {
                handleChange(uploaded)
              }}
              accept="image/*"
            />
          )} */}
        </div>
      )}

      {fieldError && <div className="mt-1 text-xs text-red-400">{fieldError}</div>}
    </div>
  )
}
