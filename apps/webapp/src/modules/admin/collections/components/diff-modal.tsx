/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useEffect, useState } from 'react'

import { CloseIcon, IconButton, LoaderRing, Modal } from '@infonomic/uikit/react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'

import { getCollectionDocumentVersion } from '@/modules/admin/collections'

// Keys that are per-version metadata rather than content — strip before diffing
// so the diff focuses on meaningful content changes.
const STRIP_KEYS = new Set(['document_version_id', 'created_at', 'updated_at', '_publishedVersion'])

function stripMeta(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).filter(([k]) => !STRIP_KEYS.has(k)))
}

export interface DiffModalProps {
  isOpen: boolean
  onDismiss: () => void
  collection: string
  documentId: string
  /** The document_version_id of the historical version to compare. */
  versionId: string
  /** A human-readable label for the historical version (e.g. a date string). */
  versionLabel: string
  /** The already-loaded current (latest) version of the document. */
  currentDocument: Record<string, unknown>
}

export function DiffModal({
  isOpen,
  onDismiss,
  collection,
  documentId,
  versionId,
  versionLabel,
  currentDocument,
}: DiffModalProps) {
  const [historicalDoc, setHistoricalDoc] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !versionId) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setHistoricalDoc(null)

    getCollectionDocumentVersion(collection, documentId, versionId)
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
  }, [isOpen, collection, documentId, versionId])

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
        <Modal.Header className="pt-4 mb-2 flex-shrink-0">
          <div className="flex flex-col">
            <h3 className="m-0 text-xl">Version Comparison</h3>
            <p className="m-0 text-sm text-gray-400">
              Comparing{' '}
              <span className="font-mono text-xs bg-canvas-700 px-1 rounded">{versionLabel}</span>{' '}
              (left) against current version (right)
            </p>
          </div>
          <IconButton onClick={onDismiss} size="xs" aria-label="Close comparison">
            <CloseIcon width="15px" height="15px" />
          </IconButton>
        </Modal.Header>

        <Modal.Content className="flex-1 overflow-auto p-0" style={{ minHeight: 0 }}>
          {loading && (
            <div className="flex items-center justify-center h-full gap-3 text-gray-400">
              <LoaderRing size={28} color="#666666" />
              <span>Loading version…</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full text-red-400">{error}</div>
          )}

          {!loading && !error && historicalDoc && (
            <div className="diff-modal-viewer font-mono text-sm">
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
