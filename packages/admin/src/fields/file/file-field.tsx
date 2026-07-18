/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import {
  type FileField as FieldType,
  isPendingStoredFileValue,
  type StoredFileValue,
} from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import {
  CloseIcon,
  DocumentIcon,
  DownloadIcon,
  ErrorText,
  HelpText,
  IconButton,
  Label,
  LoaderRing,
  VideoIcon,
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
import styles from './file-field.module.css'
import { FileUploadField } from './file-upload-field'

/**
 * Trigger a download via a temporary anchor. Mirrors the helper in
 * `image-lightbox.tsx`: same-origin URLs respect the `download` attribute and
 * save with the suggested filename; cross-origin URLs without CORS headers
 * fall through to navigation in a new tab, where the user can right-click
 * Save As.
 */
function triggerDownload(url: string, filename?: string) {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.target = '_blank'
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

interface FileFieldProps {
  field: FieldType
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
  const { t } = useTranslation('byline-admin')
  const fieldError = useFieldError(fieldPath)
  const isDirty = useIsDirty(fieldPath)
  const fieldValue = useFieldValue<StoredFileValue | null | undefined>(fieldPath)
  const isUploading = useIsFieldUploading(fieldPath)
  // `collectionPath` comes from form context rather than a prop: it is
  // constant for the form, and prop-drilling it meant any container that
  // forgot to forward it silently rendered this widget read-only.
  const { removePendingUpload, documentId, collectionPath } = useFormContext()

  const handleChange = useFieldChangeHandler(field, fieldPath)

  // Mirror the image-field rule: once the field has been touched, the form
  // value is authoritative (even when null, so a click-to-remove sticks);
  // otherwise fall back to props.
  const incomingValue = isDirty
    ? (fieldValue ?? null)
    : (value ?? fieldValue ?? defaultValue ?? null)

  const isPending = isPendingStoredFileValue(incomingValue)

  // Legacy placeholder shape — kept for backwards compatibility with older
  // seed data, matching the image-field check.
  const isOldPlaceholder = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false
    const maybe = v as Partial<StoredFileValue>
    return maybe.storageProvider === 'placeholder' && maybe.storagePath === 'pending'
  }

  const showUploadWidget = incomingValue == null || isOldPlaceholder(incomingValue)

  // `upload.requireSavedDocument` gate: until the document is persisted,
  // render a "save first" notice in place of the upload zone. Server-side
  // upload hooks that depend on save-time state (counters, document id)
  // rely on this; existing stored values still render normally below.
  const uploadGated = field.upload?.requireSavedDocument === true && documentId == null

  const handleRemove = () => {
    if (isPending) {
      removePendingUpload(fieldPath)
    }
    handleChange(null)
  }

  // MIME-driven glyph dispatch. Until a dedicated VideoField primitive lands,
  // the FileField is the canonical home for video uploads — the schema's
  // `upload.allowedMimeTypes` decides what gets in, and we swap the glyph
  // here based on the resolved MIME so the tile reads as "video" rather
  // than "generic document".
  const isVideo = incomingValue?.mimeType?.startsWith('video/') === true
  const FileGlyph = isVideo ? VideoIcon : DocumentIcon

  const htmlId = fieldPath

  return (
    <div className={`byline-field-file ${field.name}`}>
      <div className={cx('byline-field-file-header', styles.header)}>
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
            className={cx('byline-field-file-empty', styles.empty)}
            role="note"
            data-testid="upload-require-saved-document"
          >
            {t('fields.upload.requireSavedDocument')}
          </div>
        ) : collectionPath ? (
          <FileUploadField
            field={field}
            collectionPath={collectionPath}
            fieldPath={fieldPath}
            onUploaded={(uploaded) => {
              handleChange(uploaded)
            }}
          />
        ) : (
          <div className={cx('byline-field-file-empty', styles.empty)}>
            {t('fields.file.empty')}
          </div>
        )
      ) : (
        <div className={cx('byline-field-file-tile', styles.tile)}>
          {isUploading && (
            <div
              className={cx('byline-field-file-uploading', styles.uploading)}
              aria-live="polite"
              aria-busy="true"
            >
              <LoaderRing />
            </div>
          )}
          {collectionPath && (
            <div className={cx('byline-field-file-actions', styles.actions)}>
              {!isPending && incomingValue?.storageUrl && (
                <IconButton
                  type="button"
                  intent="noeffect"
                  onClick={() =>
                    triggerDownload(
                      incomingValue.storageUrl as string,
                      incomingValue.originalFilename ?? incomingValue.filename
                    )
                  }
                  size="xs"
                  disabled={isUploading}
                  aria-label={t('fields.file.downloadAriaLabel')}
                >
                  <DownloadIcon width="15px" height="15px" />
                </IconButton>
              )}
              <IconButton
                type="button"
                intent="noeffect"
                onClick={handleRemove}
                size="xs"
                disabled={isUploading}
                aria-label={t('fields.file.removeAriaLabel')}
              >
                <CloseIcon width="15px" height="15px" />
              </IconButton>
            </div>
          )}
          {/* Document icon + (optional) pending badge — mirrors the
              image-field's preview-wrap so the file tile has the same
              visual hierarchy: glyph on the left, metadata on the right.
              When the file is stored (non-pending and resolvable storageUrl),
              the wrap is rendered as an anchor that opens the asset in a new
              tab — browser-native viewer dispatch (PDFs render inline,
              non-renderable types fall through to download). */}
          {!isPending && incomingValue?.storageUrl ? (
            <a
              href={incomingValue.storageUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('fields.file.openInNewTabAriaLabel', {
                filename: incomingValue.originalFilename ?? incomingValue.filename,
              })}
              className={cx('byline-field-file-icon-wrap', styles['icon-wrap'])}
            >
              <FileGlyph
                width="48px"
                height="48px"
                className={cx('byline-field-file-icon', styles.icon)}
              />
            </a>
          ) : (
            <div className={cx('byline-field-file-icon-wrap', styles['icon-wrap'])}>
              <FileGlyph
                width="48px"
                height="48px"
                className={cx('byline-field-file-icon', styles.icon)}
              />
              {isPending && (
                <div className={cx('byline-field-file-pending', styles.pending)}>
                  {t('fields.fileMeta.pendingUpload')}
                </div>
              )}
            </div>
          )}
          <div className={cx('byline-field-file-meta', styles.meta)}>
            <div>
              <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.filename')}
              </span>{' '}
              {incomingValue?.filename}
            </div>
            <div>
              <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.original')}
              </span>{' '}
              {incomingValue?.originalFilename}
            </div>
            <div>
              <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.type')}
              </span>{' '}
              {incomingValue?.mimeType}
            </div>
            <div>
              <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                {t('fields.fileMeta.size')}
              </span>{' '}
              {incomingValue?.fileSize}
            </div>
            {isPending ? (
              <div>
                <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                  {t('fields.fileMeta.status')}
                </span>{' '}
                <span className={cx('byline-field-file-meta-pending', styles['meta-pending'])}>
                  {t('fields.fileMeta.willUploadOnSave')}
                </span>
              </div>
            ) : (
              <>
                <div>
                  <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                    {t('fields.fileMeta.storage')}
                  </span>{' '}
                  {incomingValue?.storageProvider}
                </div>
                <div>
                  <span className={cx('byline-field-file-meta-key', styles['meta-key'])}>
                    {t('fields.fileMeta.path')}
                  </span>{' '}
                  {incomingValue?.storagePath}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {field.helpText && <HelpText text={field.helpText} />}

      {fieldError && <ErrorText id={`${field.name}-error`} text={fieldError} />}
    </div>
  )
}
