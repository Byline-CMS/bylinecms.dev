'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Restore-version modal body.
 *
 * Confirmation dialog for the "make current" action on the history view.
 * Calls the restore-version server fn, invalidates the router, and
 * navigates to the document's edit view so the user lands on the freshly
 * restored draft.
 */

import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert, Button, LoaderEllipsis, Modal } from '@byline/ui'
import cx from 'classnames'

import { restoreDocumentVersion } from '../../server-fns/collections/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import styles from './restore-version-modal.module.css'

interface RestoreVersionModalProps {
  collection: string
  documentId: string
  versionId: string
  versionLabel: string
  versionNumber: number
  onClose: () => void
}

export function RestoreVersionModal({
  collection,
  documentId,
  versionId,
  versionLabel,
  versionNumber,
  onClose,
}: RestoreVersionModalProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleRestore() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await restoreDocumentVersion({
        data: { collection, id: documentId, versionId },
      })
      onClose()
      await router.invalidate()
      navigate({
        to: '/admin/collections/$collection/$id' as never,
        params: { collection, id: documentId },
      })
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'ERR_INVALID_TRANSITION') {
        setError('This version is already the current version of the document.')
      } else if (code === 'ERR_NOT_FOUND') {
        setError('The selected version could not be found. The history may be out of date.')
      } else if (code === 'ERR_FORBIDDEN' || code === 'ERR_UNAUTHENTICATED') {
        setError('You do not have permission to restore versions for this collection.')
      } else {
        setError('Could not restore this version. Please try again.')
      }
      setPending(false)
    }
  }

  return (
    <Modal.Content className={cx('byline-coll-restore-content', styles.content)}>
      <div className={cx('byline-coll-restore-body', styles.body)}>
        {error ? (
          <Alert intent="danger" close={false}>
            {error}
          </Alert>
        ) : null}
        <p className={cx('byline-coll-restore-row', styles.row)}>
          <span className="muted">Version:</span> {versionNumber}
        </p>
        <p className={cx('byline-coll-restore-row', styles.row)}>
          <span className="muted">Created:</span> {versionLabel}
        </p>
        <p className={cx('byline-coll-restore-warning', styles.warning)}>
          This will create a new draft version of this document with the content from version{' '}
          {versionNumber}, and that draft will become the current version. The existing versions
          (including any published version) are preserved in history. The restored draft will need
          to be published through the normal workflow.
        </p>
      </div>
      <div className={cx('byline-coll-restore-actions', styles.actions)}>
        <Button
          type="button"
          intent="secondary"
          size="sm"
          onClick={onClose}
          disabled={pending}
          className={cx('byline-coll-restore-button', styles.button)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          intent="primary"
          onClick={handleRestore}
          disabled={pending}
          className={cx('byline-coll-restore-button', styles.button)}
        >
          {pending === true ? <LoaderEllipsis size={42} /> : 'Restore as Draft'}
        </Button>
      </div>
    </Modal.Content>
  )
}

function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
