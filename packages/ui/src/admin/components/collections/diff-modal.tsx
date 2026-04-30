/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import { CloseIcon, IconButton, LoaderRing, Modal } from '@infonomic/uikit/react'
import cx from 'classnames'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './diff-modal.module.css'

// Keys that are per-version metadata rather than content — strip before diffing
// so the diff focuses on meaningful content changes. ClientDocument-shape
// metadata keys after the Phase 7 admin migration.
const STRIP_KEYS = new Set([
  'id',
  'versionId',
  'path',
  'status',
  'createdAt',
  'updatedAt',
  'hasPublishedVersion',
  '_publishedVersion',
])

function stripMeta(doc: Record<string, unknown>): Record<string, unknown> {
  // With the nested document shape, extract just the fields for diffing.
  if (doc.fields && typeof doc.fields === 'object') {
    return doc.fields as Record<string, unknown>
  }
  return Object.fromEntries(Object.entries(doc).filter(([k]) => !STRIP_KEYS.has(k)))
}

export interface DiffModalProps {
  isOpen: boolean
  onDismiss: () => void
  collection: string
  documentId: string
  /** The `versionId` of the historical version to compare. */
  versionId: string
  /** A human-readable label for the historical version (e.g. a date string). */
  versionLabel: string
  /** The already-loaded current (latest) version of the document. */
  currentDocument: Record<string, unknown>
  /** Content locale to compare — undefined / 'all' shows all locales. */
  locale?: string
}

export function DiffModal({
  isOpen,
  onDismiss,
  collection,
  documentId,
  versionId,
  versionLabel,
  currentDocument,
  locale,
}: DiffModalProps) {
  const { getCollectionDocumentVersion } = useBylineAdminServices()
  const [historicalDoc, setHistoricalDoc] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !versionId) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setHistoricalDoc(null)

    getCollectionDocumentVersion(collection, documentId, versionId, locale)
      .then((doc) => {
        if (cancelled) return
        setHistoricalDoc(doc)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load version')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, collection, documentId, versionId, locale, getCollectionDocumentVersion])

  const currentStr = currentDocument ? JSON.stringify(stripMeta(currentDocument), null, 2) : ''

  const historicalStr = historicalDoc ? JSON.stringify(stripMeta(historicalDoc), null, 2) : ''

  return (
    <Modal isOpen={isOpen} closeOnOverlayClick={true} onDismiss={onDismiss}>
      <Modal.Container
        style={{
          width: '96vw',
          maxWidth: '96vw',
          height: '90vh',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Modal.Header className={cx('byline-diff-modal-header', styles.header)}>
          <div className={cx('byline-diff-modal-title-stack', styles['title-stack'])}>
            <h3 className={cx('byline-diff-modal-title', styles.title)}>Version Comparison</h3>
            <p className={cx('byline-diff-modal-subtitle', styles.subtitle)}>
              Comparing{' '}
              <span className={cx('byline-diff-modal-version', styles.version)}>
                {versionLabel}
              </span>{' '}
              (left) against current version (right)
            </p>
          </div>
          <IconButton onClick={onDismiss} size="xs" aria-label="Close comparison">
            <CloseIcon width="15px" height="15px" />
          </IconButton>
        </Modal.Header>

        <Modal.Content
          className={cx('byline-diff-modal-content', styles.content)}
          style={{ minHeight: 0 }}
        >
          {loading && (
            <div className={cx('byline-diff-modal-state', styles.state)}>
              <LoaderRing size={28} color="#666666" />
              <span>Loading version…</span>
            </div>
          )}

          {error && (
            <div
              className={cx(
                'byline-diff-modal-state',
                'byline-diff-modal-error',
                styles.state,
                styles.error
              )}
            >
              {error}
            </div>
          )}

          {!loading && !error && historicalDoc && (
            <div className={cx('byline-diff-modal-viewer', styles.viewer)}>
              <ReactDiffViewer
                oldValue={historicalStr}
                newValue={currentStr}
                splitView={true}
                compareMethod={DiffMethod.LINES}
                useDarkTheme={true}
                leftTitle={versionLabel}
                rightTitle="Current version"
                hideLineNumbers={false}
              />
            </div>
          )}
        </Modal.Content>
      </Modal.Container>
    </Modal>
  )
}
