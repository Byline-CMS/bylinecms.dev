'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * User-roles drawer.
 *
 * Renders a flat checkbox list of every available role, pre-checked
 * from the user's current assignments. On save we wholesale-replace
 * the user's role-set via `setUserRoles`; the response carries the
 * authoritative stored set so the editor's "initial" baseline resets
 * cleanly.
 *
 * Standard drawer pattern (no view/edit mode toggle) — role lists are
 * short by design and the drawer is a short-lived edit context, not
 * a steady-state inspector. Save + Cancel are always visible; Save
 * is disabled until dirty.
 */

import { useState } from 'react'

import type { AdminRoleResponse, UserRolesResponse } from '@byline/admin/admin-roles'
import type { AdminUserResponse } from '@byline/admin/admin-users'
import { Alert, Button, Checkbox, LoaderEllipsis } from '@infonomic/uikit/react'
import cx from 'classnames'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './roles.module.css'

interface UserRolesProps {
  user: AdminUserResponse
  allRoles: AdminRoleResponse[]
  initialRoleIds: string[]
  onClose?: () => void
  onSaved?: (response: UserRolesResponse) => void
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

export function UserRoles({ user, allRoles, initialRoleIds, onClose, onSaved }: UserRolesProps) {
  const { setUserRoles } = useBylineAdminServices()
  const [initialSet, setInitialSet] = useState<ReadonlySet<string>>(() => new Set(initialRoleIds))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialRoleIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const isDirty = !setsEqual(selected, initialSet)

  function handleToggle(roleId: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(roleId)
      else next.delete(roleId)
      return next
    })
    setSuccessMessage(null)
  }

  async function handleSave(): Promise<void> {
    if (saving) return
    setSaving(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await setUserRoles({
        data: { userId: user.id, roleIds: Array.from(selected) },
      })
      const storedSet = new Set(response.roles.map((r) => r.id))
      setInitialSet(storedSet)
      setSelected(new Set(storedSet))
      setSuccessMessage('Saved.')
      onSaved?.(response)
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'admin.roles.userNotFound') {
        setError('This user no longer exists.')
      } else if (code === 'admin.roles.notFound') {
        setError('One or more selected roles no longer exist. Reload the page and try again.')
      } else {
        setError('Could not save roles. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cx('byline-user-roles-wrap', styles.wrap)}>
      {error ? <Alert intent="danger">{error}</Alert> : null}
      {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

      {allRoles.length === 0 ? (
        <p className={cx('muted', 'byline-user-roles-empty', styles.empty)}>
          No roles have been created yet. Create roles in{' '}
          <span className="muted">/admin/roles</span> first.
        </p>
      ) : (
        <div className={cx('byline-user-roles-list', styles.list)}>
          {allRoles.map((role) => (
            <div key={role.id} className={cx('byline-user-roles-row', styles.row)}>
              <Checkbox
                id={`role-${role.id}`}
                name={`role-${role.id}`}
                checked={selected.has(role.id)}
                disabled={saving}
                onCheckedChange={(checked) => handleToggle(role.id, checked === true)}
                containerClasses={cx('byline-user-roles-checkbox-auto', styles['checkbox-auto'])}
                componentClasses={cx('byline-user-roles-checkbox-auto', styles['checkbox-auto'])}
              />
              <label
                htmlFor={`role-${role.id}`}
                className={cx('byline-user-roles-label', styles.label)}
              >
                <div className={cx('byline-user-roles-label-head', styles['label-head'])}>
                  <span className={cx('byline-user-roles-name', styles.name)}>{role.name}</span>
                  <code className={cx('byline-user-roles-machine', styles.machine)}>
                    {role.machine_name}
                  </code>
                </div>
                {role.description ? (
                  <p className={cx('muted', 'byline-user-roles-description', styles.description)}>
                    {role.description}
                  </p>
                ) : null}
              </label>
            </div>
          ))}
        </div>
      )}

      <div className={cx('byline-user-roles-actions', styles.actions)}>
        <Button
          type="button"
          intent="secondary"
          size="xs"
          onClick={onClose}
          disabled={saving}
          className={cx('byline-user-roles-action', styles.action)}
        >
          {successMessage ? 'Close' : 'Cancel'}
        </Button>
        <Button
          type="button"
          intent="primary"
          size="xs"
          onClick={() => void handleSave()}
          disabled={saving || !isDirty}
          className={cx('byline-user-roles-action', styles.action)}
        >
          {saving ? <LoaderEllipsis size={30} /> : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
