'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import cx from 'classnames'

import { IconButton } from '../../components/button/icon-button.js'
import { CloseIcon } from '../../icons/close-icon.js'
import { DownloadIcon } from '../../icons/download-icon.js'
import { Modal } from '../modal/modal.js'
import styles from './image-lightbox.module.css'

export interface ImageLightboxProps {
  isOpen: boolean
  onDismiss: () => void
  /** Full-resolution image URL. */
  src: string
  /** Alt text — falls back to filename. */
  alt?: string
  /** Used as the `download` attribute on the download link. */
  downloadFilename?: string
  /** Header label. Defaults to `downloadFilename`. */
  title?: string
  /** Optional metadata row beneath the image. */
  meta?: {
    width?: number | null
    height?: number | null
    fileSize?: number | null
    mimeType?: string | null
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Trigger a download via a temporary anchor. Uses the `download` attribute so
 * same-origin URLs save with the suggested filename; cross-origin URLs that
 * don't honour the attribute will navigate to the file in a new tab, where
 * the user can still right-click to save.
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

/**
 * ImageLightbox — modal preview of a full-resolution image with a download
 * affordance. Right-click on the image works natively (browser "Save image
 * as…") because it's a regular `<img src>`.
 */
export function ImageLightbox({
  isOpen,
  onDismiss,
  src,
  alt,
  downloadFilename,
  title,
  meta,
}: ImageLightboxProps) {
  const headingText = title ?? downloadFilename ?? 'Image'
  const altText = alt ?? downloadFilename ?? 'Image preview'

  return (
    <Modal isOpen={isOpen} closeOnOverlayClick={true} onDismiss={onDismiss}>
      <Modal.Container className={cx('byline-image-lightbox-container', styles.container)}>
        <Modal.Header className={cx('byline-image-lightbox-header', styles.header)}>
          <div className={cx('byline-image-lightbox-title-stack', styles['title-stack'])}>
            <h3 className={cx('byline-image-lightbox-title', styles.title)}>{headingText}</h3>
            {meta?.width != null && meta?.height != null && (
              <p className={cx('byline-image-lightbox-subtitle', styles.subtitle)}>
                {meta.width}×{meta.height}
                {meta.fileSize != null ? ` · ${formatFileSize(meta.fileSize)}` : ''}
                {meta.mimeType ? ` · ${meta.mimeType}` : ''}
              </p>
            )}
          </div>
          <div className={cx('byline-image-lightbox-actions', styles['header-actions'])}>
            <IconButton
              onClick={() => triggerDownload(src, downloadFilename)}
              size="xs"
              aria-label="Download original"
            >
              <DownloadIcon width="15px" height="15px" />
            </IconButton>
            <IconButton onClick={onDismiss} size="xs" aria-label="Close preview">
              <CloseIcon width="15px" height="15px" />
            </IconButton>
          </div>
        </Modal.Header>

        <Modal.Content className={cx('byline-image-lightbox-content', styles.content)}>
          <img
            src={src}
            alt={altText}
            className={cx('byline-image-lightbox-image', styles.image)}
          />
        </Modal.Content>
      </Modal.Container>
    </Modal>
  )
}
