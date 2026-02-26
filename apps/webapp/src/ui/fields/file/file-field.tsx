/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FileField as FieldType, StoredFileValue } from '@byline/core'

import { useFieldError, useFieldValue, useIsDirty } from '../form-context'

interface FileFieldProps {
  field: FieldType
  // Stored value is currently a plain object with file metadata
  // coming from the seed data / storage layer.
  value?: StoredFileValue | null
  defaultValue?: StoredFileValue | null
  onChange?: (value: StoredFileValue | null) => void
  path?: string
}

export const FileField = ({
  field,
  value,
  defaultValue,
  onChange: _onChange,
  path,
}: FileFieldProps) => {
  const fieldPath = path ?? field.name
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<StoredFileValue | null | undefined>(fieldPath)
  const incomingValue = value ?? fieldValue ?? defaultValue ?? null

  const isPlaceholderStoredFileValue = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false
    const maybe = v as Partial<StoredFileValue>
    return maybe.storage_provider === 'placeholder' && maybe.storage_path === 'pending'
  }

  const effectiveValue: StoredFileValue | null = isPlaceholderStoredFileValue(incomingValue)
    ? null
    : incomingValue

  return (
    <div className={`byline-file ${field.name}${isDirty ? ' border border-blue-300 rounded-md p-3' : ''}`}>
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-sm font-medium text-gray-100">
            {field.label ?? field.name}
            {field.required ? ' *' : ''}
          </div>
          {field.helpText && <div className="mt-0.5 text-xs text-gray-400">{field.helpText}</div>}
        </div>
        {/* Placeholder action area for future upload UI */}
        <button
          type="button"
          className="text-xs text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline"
          disabled
        >
          Upload (coming soon)
        </button>
      </div>

      {effectiveValue == null ? (
        <div className="text-xs text-gray-500 italic">No file selected</div>
      ) : (
        <div className="mt-1 text-xs text-gray-200 space-y-0.5">
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
          <div>
            <span className="font-semibold">Path:</span> {effectiveValue.storage_path}
          </div>
        </div>
      )}

      {fieldError && <div className="mt-1 text-xs text-red-400">{fieldError}</div>}
    </div>
  )
}
