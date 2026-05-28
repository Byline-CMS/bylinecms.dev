'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Delete-user modal body.
 *
 * Rendered inside `AccountContainer`'s `<Modal.Container>`, so this
 * component only lays out the content + action row — the modal header
 * and dismiss button are already drawn by the container.
 *
 * On success we navigate away to `/admin/users`; the record that hosts
 * this view no longer exists. The `onSuccess` callback on `PanelProps`
 * is unused here because `delete` produces no updated user.
 */

import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { useTranslation } from '@byline/i18n/react'
import { Alert, Button, LoaderEllipsis, Modal } from '@byline/ui/react'
import cx from 'classnames'

import { type AdminUserResponse, deleteAdminUser } from '../../server-fns/admin-users/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import styles from './delete.module.css'

interface DeleteUserProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

function displayNameFor(user: AdminUserResponse): string {
  const parts = [user.given_name, user.family_name].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return parts.length > 0 ? parts.join(' ') : user.email
}

export function DeleteUser({ user, onClose }: DeleteUserProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const { t } = useTranslation('byline-admin')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleDelete() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await deleteAdminUser({ data: { id: user.id, vid: user.vid } })
      onClose?.()
      // Invalidate before navigating so the list-route loader is
      // forced to re-fetch — without this, TanStack Router can serve
      // the cached pre-delete list.
      await router.invalidate()
      navigate({ to: '/admin/users' as never })
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'admin.users.selfDeleteForbidden') {
        setError(t('adminUsers.delete.errors.selfDelete'))
      } else if (code === 'admin.users.versionConflict') {
        setError(t('adminUsers.delete.errors.versionConflict'))
      } else if (code === 'admin.users.notFound') {
        setError(t('adminUsers.delete.errors.notFound'))
      } else {
        setError(t('adminUsers.delete.errors.fallback'))
      }
      setPending(false)
    }
  }

  return (
    <Modal.Content className={cx('byline-admin-user-delete-content', styles.content)}>
      <div className={cx('byline-admin-user-delete-body', styles.body)}>
        {error ? (
          <Alert intent="danger" close={false}>
            {error}
          </Alert>
        ) : null}
        <p className={cx('byline-admin-user-delete-row', styles.row)}>
          <span className="muted">{t('adminUsers.delete.userLabel')}</span> {displayNameFor(user)}
        </p>
        <p className={cx('byline-admin-user-delete-row', styles.row)}>
          <span className="muted">{t('adminUsers.delete.emailLabel')}</span> {user.email}
        </p>
        <p className={cx('byline-admin-user-delete-warning', styles.warning)}>
          {t('adminUsers.delete.warning')}
        </p>
      </div>
      <div className={cx('byline-admin-user-delete-actions', styles.actions)}>
        <Button
          type="button"
          intent="secondary"
          size="sm"
          onClick={onClose}
          disabled={pending}
          className={cx('byline-admin-user-delete-button', styles.button)}
        >
          {t('common.actions.cancel')}
        </Button>
        <Button
          size="sm"
          intent="danger"
          onClick={handleDelete}
          disabled={pending}
          className={cx('byline-admin-user-delete-button', styles.button)}
        >
          {pending === true ? <LoaderEllipsis size={42} /> : t('adminUsers.delete.confirmButton')}
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
