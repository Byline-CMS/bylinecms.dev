/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FileField as FieldType, StoredFileValue } from '@byline/core'
import { ErrorText } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useFieldError, useFieldValue, useIsDirty } from '../../forms/form-context'
import styles from './file-field.module.css'

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
    return maybe.storageProvider === 'placeholder' && maybe.storagePath === 'pending'
  }

  const effectiveValue: StoredFileValue | null = isPlaceholderStoredFileValue(incomingValue)
    ? null
    : incomingValue

  return (
    <div
      className={cx(
        'byline-field-file',
        field.name,
        isDirty && ['byline-field-file-dirty', styles.dirty]
      )}
    >
      <div className={cx('byline-field-file-header', styles.header)}>
        <div>
          <div className={cx('byline-field-file-label', styles.label)}>
            {field.label ?? field.name}
            {field.optional ? '' : ' *'}
          </div>
          {field.helpText && (
            <div className={cx('byline-field-file-help', styles.help)}>{field.helpText}</div>
          )}
        </div>
        {/* Placeholder action area for future upload UI */}
        <button type="button" className={cx('byline-field-file-action', styles.action)} disabled>
          Upload (coming soon)
        </button>
      </div>

      {effectiveValue == null ? (
        <div className={cx('byline-field-file-empty', styles.empty)}>No file selected</div>
      ) : (
        <div className={cx('byline-field-file-meta', styles.meta)}>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Filename:</span>{' '}
            {effectiveValue.filename}
          </div>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Original:</span>{' '}
            {effectiveValue.originalFilename}
          </div>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Type:</span>{' '}
            {effectiveValue.mimeType}
          </div>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Size:</span>{' '}
            {effectiveValue.fileSize}
          </div>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Storage:</span>{' '}
            {effectiveValue.storageProvider}
          </div>
          <div>
            <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>Path:</span>{' '}
            {effectiveValue.storagePath}
          </div>
        </div>
      )}

      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
    </div>
  )
}
