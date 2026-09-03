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
 * The resource wrapper injects restore and post-restore navigation so this
 * confirmation body works for both collection documents and singletons.
 */

import { useState } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, LoaderEllipsis, Modal, useToastManager } from '@byline/ui/react'
import cx from 'clsx'

import { hasCommittedDocumentHookFailure } from '../../server-fns/collections/save-outcome.js'
import styles from './restore-version-modal.module.css'

interface RestoreVersionModalProps {
  versionLabel: string
  versionNumber: number
  restoreStatusLabel: string
  onClose: () => void
  restoreVersion: () => Promise<unknown>
  onRestoreComplete: () => void | Promise<void>
}

export function RestoreVersionModal({
  versionLabel,
  versionNumber,
  restoreStatusLabel,
  onClose,
  restoreVersion,
  onRestoreComplete,
}: RestoreVersionModalProps) {
  const { t } = useTranslation('byline-admin')
  const toastManager = useToastManager()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleRestore() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await restoreVersion()
      if (hasCommittedDocumentHookFailure(result)) {
        toastManager.add({
          title: t('collections.save.hookFailedToast'),
          description: t('collections.save.hookFailedDescription'),
          data: { intent: 'warning', iconType: 'warning', icon: true, close: true },
        })
      }
      onClose()
      await onRestoreComplete()
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'ERR_INVALID_TRANSITION') {
        setError(t('collections.restore.errors.alreadyCurrent'))
      } else if (code === 'ERR_NOT_FOUND') {
        setError(t('collections.restore.errors.notFound'))
      } else if (code === 'ERR_FORBIDDEN' || code === 'ERR_UNAUTHENTICATED') {
        setError(t('collections.restore.errors.forbidden'))
      } else {
        setError(t('collections.restore.errors.fallback'))
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
          <span className="muted">{t('collections.restore.versionLabel')}</span> {versionNumber}
        </p>
        <p className={cx('byline-coll-restore-row', styles.row)}>
          <span className="muted">{t('collections.restore.createdLabel')}</span> {versionLabel}
        </p>
        <p className={cx('byline-coll-restore-warning', styles.warning)}>
          {t('collections.restore.warning', {
            version: versionNumber,
            status: restoreStatusLabel,
          })}
        </p>
      </div>
      <div className={cx('byline-coll-restore-actions', styles.actions)}>
        <button
          data-autofocus
          type="button"
          tabIndex={0}
          className={cx('byline-form-actions-sr-only', styles['sr-only'])}
        >
          no action
        </button>
        <Button
          type="button"
          style={{ minWidth: '80px' }}
          intent="noeffect"
          size="sm"
          onClick={onClose}
          disabled={pending}
          className={cx('byline-coll-restore-button', styles.button)}
        >
          {t('common.actions.cancel')}
        </Button>
        <Button
          size="sm"
          intent="primary"
          onClick={handleRestore}
          style={{ minWidth: '80px' }}
          disabled={pending}
          className={cx('byline-coll-restore-button', styles.button)}
        >
          {pending === true ? (
            <LoaderEllipsis size={42} />
          ) : (
            t('collections.restore.confirmButton', { status: restoreStatusLabel })
          )}
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
