'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Delete-role modal body. Rendered inside the role-detail container's
 * `<Modal.Container>`. On success we navigate back to the role list —
 * the record that hosts this view no longer exists.
 *
 * Cascading deletes remove role ↔ user assignments and per-role
 * permission grants automatically (FK cascades on the join tables).
 */

import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { Alert, Button, LoaderEllipsis, Modal } from '@infonomic/uikit/react'

import { lngParam, useLocale } from '@/i18n/hooks/use-locale-navigation'
import { deleteAdminRole } from '../index'
import type { AdminRoleResponse } from '../index'

interface DeleteRoleProps {
  role: AdminRoleResponse
  onClose?: () => void
  onSuccess?: (role: AdminRoleResponse) => void
}

export function DeleteRole({ role, onClose }: DeleteRoleProps) {
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
      await deleteAdminRole({ data: { id: role.id, vid: role.vid } })
      onClose?.()
      // Invalidate before navigating so the list-route loader is
      // forced to re-fetch — without this, TanStack Router can serve
      // the cached pre-delete list.
      await router.invalidate()
      navigate({
        to: '/{-$lng}/admin/roles',
        params: { ...lngParam(locale) },
      })
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'admin.roles.versionConflict') {
        setError(
          'This role has been modified elsewhere since you opened this dialog. Close and reload before trying again.'
        )
      } else if (code === 'admin.roles.notFound') {
        setError('This role has already been deleted.')
      } else {
        setError('Could not delete this role. Please try again.')
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
          <span className="muted">Role:</span> {role.name}
        </p>
        <p className="m-0">
          <span className="muted">Machine name:</span> {role.machine_name}
        </p>
        <p className="mt-3 text-red-600 dark:text-red-300">
          This will permanently delete the role. Any users assigned to it lose the role; any
          per-role ability grants are removed. The action cannot be undone.
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
          {pending === true ? <LoaderEllipsis size={42} /> : 'Delete Role'}
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
