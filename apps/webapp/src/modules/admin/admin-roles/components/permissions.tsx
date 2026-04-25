'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Per-role ability editor.
 *
 * Mounts inside the role-detail drawer. Renders the registered ability
 * catalog grouped by `group`, pre-checked from the role's current
 * grants. Each group has select-all / clear-all affordances and a
 * "selected of total" count. Saving wholesale-replaces the role's
 * abilities via `setRoleAbilities`; the response carries the
 * authoritative stored set so the editor's "initial" baseline resets
 * cleanly without a second round-trip.
 *
 * Vid-less by design — abilities live in `byline_admin_permissions`,
 * not on the role row, so editing them does not bump the role's `vid`.
 * Last-writer-wins on a per-role basis.
 */

import { useMemo, useState } from 'react'

import { Alert, Button, Checkbox, LoaderEllipsis } from '@infonomic/uikit/react'

import { setRoleAbilities } from '@/modules/admin/admin-permissions'
import type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesResponse,
} from '@/modules/admin/admin-permissions'
import type { AdminRoleResponse } from '../index'

interface RolePermissionsProps {
  role: AdminRoleResponse
  registered: ListRegisteredAbilitiesResponse
  initialAbilities: string[]
  onClose?: () => void
  onSaved?: (response: SetRoleAbilitiesResponse) => void
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

interface GroupSectionProps {
  group: AbilityGroupResponse
  selected: ReadonlySet<string>
  disabled: boolean
  onToggle: (key: string, checked: boolean) => void
  onSelectAll: (groupKeys: readonly string[]) => void
  onClearAll: (groupKeys: readonly string[]) => void
}

function GroupSection({
  group,
  selected,
  disabled,
  onToggle,
  onSelectAll,
  onClearAll,
}: GroupSectionProps) {
  const groupKeys = useMemo(() => group.abilities.map((a) => a.key), [group.abilities])
  const selectedInGroup = groupKeys.filter((key) => selected.has(key)).length

  return (
    <div className="rounded-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-100 p-3 dark:border-gray-700">
        <div>
          <span className="font-medium">{group.group}</span>
          <span className="muted ml-2 text-xs">
            {selectedInGroup} of {group.abilities.length} selected
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            intent="secondary"
            type="button"
            disabled={disabled || selectedInGroup === group.abilities.length}
            onClick={() => onSelectAll(groupKeys)}
          >
            Select all
          </Button>
          <Button
            size="sm"
            intent="secondary"
            type="button"
            disabled={disabled || selectedInGroup === 0}
            onClick={() => onClearAll(groupKeys)}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1 p-3">
        {group.abilities.map((ability: AbilityDescriptorResponse) => (
          <div key={ability.key} className="flex items-start gap-2 py-1">
            <Checkbox
              id={`ability-${ability.key}`}
              name={`ability-${ability.key}`}
              checked={selected.has(ability.key)}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(ability.key, checked === true)}
            />
            <label htmlFor={`ability-${ability.key}`} className="min-w-0 flex-1 cursor-pointer">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{ability.label}</span>
                <code className="rounded-sm bg-gray-50 px-1.5 py-0.5 text-xs dark:bg-canvas-800">
                  {ability.key}
                </code>
              </div>
              {ability.description ? (
                <p className="muted mb-0 text-xs">{ability.description}</p>
              ) : null}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RolePermissions({
  role,
  registered,
  initialAbilities,
  onClose,
  onSaved,
}: RolePermissionsProps) {
  const [initialSet, setInitialSet] = useState<ReadonlySet<string>>(() => new Set(initialAbilities))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialAbilities))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const isDirty = !setsEqual(selected, initialSet)
  const totalSelected = selected.size

  function handleToggle(key: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
    setSuccessMessage(null)
  }

  function handleSelectAll(groupKeys: readonly string[]): void {
    setSelected((current) => {
      const next = new Set(current)
      for (const key of groupKeys) next.add(key)
      return next
    })
    setSuccessMessage(null)
  }

  function handleClearAll(groupKeys: readonly string[]): void {
    setSelected((current) => {
      const next = new Set(current)
      for (const key of groupKeys) next.delete(key)
      return next
    })
    setSuccessMessage(null)
  }

  async function handleSave(): Promise<void> {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await setRoleAbilities({
        data: { id: role.id, abilities: Array.from(selected) },
      })
      // Reset baseline to the authoritative stored set — guards against
      // any dedupe/normalisation the server might apply.
      const storedSet = new Set(response.abilities)
      setInitialSet(storedSet)
      setSelected(new Set(storedSet))
      setSuccessMessage('Saved.')
      onSaved?.(response)
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'admin.permissions.roleNotFound') {
        setError('This role no longer exists.')
      } else if (code === 'admin.permissions.abilityUnregistered') {
        setError(
          'One or more selected abilities are no longer registered. Reload the page and try again.'
        )
      } else {
        setError('Could not save permissions. Please try again.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="form flex flex-col gap-3 p-1">
      <div className="flex items-center justify-between">
        <p className="muted m-0 text-sm">
          {totalSelected} of {registered.total} abilities selected for{' '}
          <span className="font-medium">{role.name}</span>
        </p>
      </div>

      {error ? <Alert intent="danger">{error}</Alert> : null}
      {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

      <div className="flex flex-col gap-2">
        {registered.groups.map((group) => (
          <GroupSection
            key={group.group}
            group={group}
            selected={selected}
            disabled={isSaving}
            onToggle={handleToggle}
            onSelectAll={handleSelectAll}
            onClearAll={handleClearAll}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          type="button"
          intent="secondary"
          size="sm"
          onClick={onClose}
          disabled={isSaving}
          className="min-w-16"
        >
          {successMessage ? 'Close' : 'Cancel'}
        </Button>
        <Button
          type="button"
          size="sm"
          intent="primary"
          onClick={() => void handleSave()}
          disabled={isSaving || !isDirty}
          className="min-w-16"
        >
          {isSaving ? <LoaderEllipsis size={42} /> : 'Save'}
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
