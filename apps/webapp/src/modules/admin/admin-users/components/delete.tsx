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
import { useNavigate, useRouter } from '@tanstack/react-router'

import { Alert, Button, LoaderEllipsis, Modal } from '@infonomic/uikit/react'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { deleteAdminUser } from '../index'
import type { AdminUserResponse } from '../index'

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
  const locale = useLocale()
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
      navigate({
        to: '/{-$lng}/admin/users',
        params: { ...lngParam(locale) },
      })
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'admin.users.selfDeleteForbidden') {
        setError('You cannot delete your own admin account.')
      } else if (code === 'admin.users.versionConflict') {
        setError(
          'This user has been modified elsewhere since you opened this dialog. Close and reload before trying again.'
        )
      } else if (code === 'admin.users.notFound') {
        setError('This user has already been deleted.')
      } else {
        setError('Could not delete this admin user. Please try again.')
      }
      setPending(false)
    }
  }

  return (
    <Modal.Content className="gap-1">
      <div className="flex flex-col gap-2">
        {error ? (
          <Alert intent="danger" close={false}>
            {error}
          </Alert>
        ) : null}
        <p className="m-0">
          <span className="muted">User:</span> {displayNameFor(user)}
        </p>
        <p className="m-0">
          <span className="muted">Email:</span> {user.email}
        </p>
        <p className="mt-3 text-red-600 dark:text-red-300">
          This will permanently delete the admin user. The action cannot be undone. Any active
          sessions will be invalidated at the next refresh.
        </p>
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button
          type="button"
          intent="secondary"
          size="sm"
          onClick={onClose}
          disabled={pending}
          className="min-w-16"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          intent="danger"
          onClick={handleDelete}
          disabled={pending}
          className="min-w-16"
        >
          {pending === true ? <LoaderEllipsis size={42} /> : 'Delete User'}
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
