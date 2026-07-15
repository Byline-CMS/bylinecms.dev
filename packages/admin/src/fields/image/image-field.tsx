/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import {
  type ImageField as FieldType,
  isPendingStoredFileValue,
  type StoredFileValue,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import {
  CloseIcon,
  ErrorText,
  HelpText,
  IconButton,
  ImageLightbox,
  Label,
  LoaderRing,
} from '@byline/ui/react'
import cx from 'classnames'

import {
  useFieldError,
  useFieldValue,
  useFormContext,
  useIsDirty,
  useIsFieldUploading,
} from '../../forms/form-context'
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
  const isUploading = useIsFieldUploading(fieldPath)
  const { removePendingUpload, documentId } = useFormContext()
  const { t } = useTranslation('byline-admin')

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

  // `upload.requireSavedDocument` gate: until the document is persisted,
  // render a "save first" notice in place of the upload zone. Server-side
  // upload hooks that depend on save-time state (counters, document id)
  // rely on this; existing stored values still render normally below.
  const uploadGated = field.upload?.requireSavedDocument === true && documentId == null

  // Prefer the generated thumbnail variant for the preview tile. SVGs and
  // other bypass types have no variants — fall back to the original.
  const thumbVariant =
    incomingValue && !isPendingStoredFileValue(incomingValue)
      ? incomingValue.variants?.find((v) => v.name === 'thumbnail')
      : undefined
  const previewUrl = thumbVariant?.storageUrl ?? incomingValue?.storageUrl

  // Handle remove, including cleanup of pending uploads
  const handleRemove = () => {
    if (isPending) {
      removePendingUpload(fieldPath)
    }
    handleChange(null)
  }

  // Lightbox state — only enabled for stored (non-pending) images that have a
  // resolvable original storageUrl.
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const canOpenLightbox = !isPending && !!incomingValue?.storageUrl

  const htmlId = fieldPath

  return (
    <div className={`byline-field-image ${field.name}`}>
      <div className={cx('byline-field-image-header', styles.header)}>
        <Label
          id={htmlId}
          htmlFor={htmlId}
          label={field.label ?? field.name}
          required={!field.optional}
        />
      </div>

      {showUploadWidget ? (
        uploadGated ? (
          <div
            className={cx('byline-field-image-empty', styles.empty)}
            role="note"
            data-testid="upload-require-saved-document"
          >
            {t('fields.upload.requireSavedDocument')}
          </div>
        ) : collectionPath ? (
          <ImageUploadField
            field={field}
            collectionPath={collectionPath}
            fieldPath={fieldPath}
            onUploaded={(uploaded) => {
              handleChange(uploaded)
            }}
          />
        ) : (
          <div className={cx('byline-field-image-empty', styles.empty)}>
            {t('fields.image.empty')}
          </div>
        )
      ) : (
        <div className={cx('byline-field-image-tile', styles.tile)}>
          {isUploading && (
            <div
              className={cx('byline-field-image-uploading', styles.uploading)}
              aria-live="polite"
              aria-busy="true"
            >
              <LoaderRing />
            </div>
          )}
          {/* Remove button — shown when an image is set (including pending) */}
          {collectionPath && (
            <div className={cx('byline-field-image-remove', styles.remove)}>
              <IconButton
                type="button"
                intent="noeffect"
                onClick={handleRemove}
                size="xs"
                disabled={isUploading}
                aria-label={t('fields.image.removeAriaLabel')}
              >
                <CloseIcon width="15px" height="15px" />
              </IconButton>
            </div>
          )}
          {/* Preview */}
          {previewUrl && (
            <div className={cx('byline-field-image-preview-wrap', styles['preview-wrap'])}>
              {canOpenLightbox ? (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label={t('fields.image.openLightboxAriaLabel')}
                  className={cx('byline-field-image-preview-button', styles['preview-button'])}
                >
                  <img
                    src={previewUrl}
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
                </button>
              ) : (
                <img
                  src={previewUrl}
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
              )}
              {/* Pending upload badge */}
              {isPending && (
                <div className={cx('byline-field-image-pending', styles.pending)}>
                  {t('fields.fileMeta.pendingUpload')}
                </div>
              )}
            </div>
          )}
          {/* Metadata */}
          <div className={cx('byline-field-image-meta', styles.meta)}>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.filename')}
              </span>{' '}
              {incomingValue?.filename}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.original')}
              </span>{' '}
              {incomingValue?.originalFilename}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.type')}
              </span>{' '}
              {incomingValue?.mimeType}
            </div>
            <div>
              <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.size')}
              </span>{' '}
              {incomingValue?.fileSize}
            </div>
            {isPending ? (
              <div>
                <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                  {t('fields.fileMeta.status')}
                </span>{' '}
                <span className={cx('byline-field-image-meta-pending', styles['meta-pending'])}>
                  {t('fields.fileMeta.willUploadOnSave')}
                </span>
              </div>
            ) : (
              <>
                <div>
                  <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                    {t('fields.fileMeta.storage')}
                  </span>{' '}
                  {incomingValue?.storageProvider}
                </div>
                {incomingValue?.imageWidth != null && (
                  <div>
                    <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                      {t('fields.imageMeta.dimensions')}
                    </span>{' '}
                    {incomingValue.imageWidth}
                    {incomingValue.imageHeight != null ? `×${incomingValue.imageHeight}` : ''}
                  </div>
                )}
                {incomingValue?.imageFormat != null && (
                  <div>
                    <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                      {t('fields.imageMeta.format')}
                    </span>{' '}
                    {incomingValue.imageFormat}
                  </div>
                )}
                <div>
                  <span className={cx('byline-field-image-meta-key', styles['meta-key'])}>
                    {t('fields.imageMeta.thumbnail')}
                  </span>{' '}
                  {thumbVariant
                    ? t('fields.imageMeta.thumbnailGenerated')
                    : t('fields.imageMeta.thumbnailPending')}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {field.helpText && <HelpText text={field.helpText} />}

      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}

      {canOpenLightbox && incomingValue?.storageUrl && (
        <ImageLightbox
          isOpen={lightboxOpen}
          onDismiss={() => setLightboxOpen(false)}
          src={incomingValue.storageUrl}
          alt={incomingValue.originalFilename ?? incomingValue.filename}
          downloadFilename={incomingValue.originalFilename ?? incomingValue.filename}
          title={incomingValue.originalFilename ?? incomingValue.filename}
          meta={{
            width: incomingValue.imageWidth,
            height: incomingValue.imageHeight,
            fileSize: incomingValue.fileSize,
            mimeType: incomingValue.mimeType,
          }}
        />
      )}
    </div>
  )
}
