/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { ImageField as FieldType, StoredFileValue } from '@byline/core'

import { useFieldError, useFieldValue, useIsDirty } from '../form-context'

interface ImageFieldProps {
  field: FieldType
  // Stored value is currently a plain object with file/image metadata
  // coming from the seed data / storage layer.
  value?: StoredFileValue | null
  defaultValue?: StoredFileValue | null
  onChange?: (value: StoredFileValue | null) => void
  path?: string
}

export const ImageField = ({
  field,
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

  const isPlaceholderStoredFileValue = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false
    const maybe = v as Partial<StoredFileValue>
    return maybe.storage_provider === 'placeholder' && maybe.storage_path === 'pending'
  }

  const effectiveValue: StoredFileValue | null = isPlaceholderStoredFileValue(incomingValue)
    ? null
    : incomingValue

  return (
    <div className={isDirty ? 'border border-blue-300 rounded-md p-3' : ''}>
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
          Upload image (coming soon)
        </button>
      </div>

      {effectiveValue == null ? (
        <div className="text-xs text-gray-500 italic">No image selected</div>
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
      )}

      {fieldError && <div className="mt-1 text-xs text-red-400">{fieldError}</div>}
    </div>
  )
}
