'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Inline per-role ability editor. Renders below the role-details
 * header on the role detail page — full-width, no drawer.
 *
 * Mode-switched: defaults to **view** (checkboxes disabled, no edit
 * affordances). Click Edit to switch to **edit** mode — checkboxes
 * become interactive, per-group "Select all / Clear" buttons appear,
 * and a Save button materialises once the selection diverges from the
 * stored set. Cancel reverts the local set and returns to view mode.
 *
 * The View toggle is disabled while there are unsaved changes — this
 * is the explicit-intent equivalent of a confirm dialog and keeps the
 * UX honest about whether changes have been persisted.
 *
 * Vid-less by design (see Phase B notes): abilities live in
 * `byline_admin_permissions`, not on the role row, so editing them
 * does not bump the role's `vid`. Last-writer-wins on a per-role basis.
 */

import { useMemo, useState } from 'react'

import { Alert, Button, Checkbox, LoaderEllipsis } from '@infonomic/uikit/react'
import cx from 'classnames'

import { setRoleAbilities } from '@/modules/admin/admin-permissions'
import type {
  AbilityDescriptorResponse,
  AbilityGroupResponse,
  ListRegisteredAbilitiesResponse,
  SetRoleAbilitiesResponse,
} from '@/modules/admin/admin-permissions'
import type { AdminRoleResponse } from '../index'

type Mode = 'view' | 'edit'

interface RolePermissionsProps {
  role: AdminRoleResponse
  registered: ListRegisteredAbilitiesResponse
  initialAbilities: string[]
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
  mode: Mode
  saving: boolean
  onToggle: (key: string, checked: boolean) => void
  onSelectAll: (groupKeys: readonly string[]) => void
  onClearAll: (groupKeys: readonly string[]) => void
}

function GroupSection({
  group,
  selected,
  mode,
  saving,
  onToggle,
  onSelectAll,
  onClearAll,
}: GroupSectionProps) {
  const groupKeys = useMemo(() => group.abilities.map((a) => a.key), [group.abilities])
  const selectedInGroup = groupKeys.filter((key) => selected.has(key)).length
  const isEdit = mode === 'edit'

  return (
    <div className="rounded-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-100 p-3 dark:border-gray-700">
        <div>
          <span className="font-medium">{group.group}</span>
          <span className="muted ml-2 text-xs">
            {selectedInGroup} of {group.abilities.length} {isEdit ? 'selected' : 'granted'}
          </span>
        </div>
        {isEdit ? (
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              intent="secondary"
              type="button"
              disabled={saving || selectedInGroup === group.abilities.length}
              onClick={() => onSelectAll(groupKeys)}
            >
              Select all
            </Button>
            <Button
              size="xs"
              intent="secondary"
              type="button"
              disabled={saving || selectedInGroup === 0}
              onClick={() => onClearAll(groupKeys)}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-2">
        {group.abilities.map((ability: AbilityDescriptorResponse) => (
          <div key={ability.key} className="flex items-start gap-2 py-1">
            <Checkbox
              id={`ability-${ability.key}`}
              name={`ability-${ability.key}`}
              checked={selected.has(ability.key)}
              disabled={!isEdit || saving}
              onCheckedChange={(checked) => onToggle(ability.key, checked === true)}
              // Override the uikit Checkbox container's `width: 100%` so it
              // shrinks to its button width — otherwise the external label
              // is pushed away by an empty 100%-wide container.
              containerClasses="!w-auto"
              componentClasses="!w-auto"
            />
            <label
              htmlFor={`ability-${ability.key}`}
              className={cx('min-w-0 flex-1', isEdit ? 'cursor-pointer' : 'cursor-default')}
            >
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
  onSaved,
}: RolePermissionsProps) {
  const [mode, setMode] = useState<Mode>('view')
  const [initialSet, setInitialSet] = useState<ReadonlySet<string>>(() => new Set(initialAbilities))
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialAbilities))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = !setsEqual(selected, initialSet)
  const totalSelected = selected.size

  function handleToggle(key: string, checked: boolean): void {
    if (mode !== 'edit') return
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function handleSelectAll(groupKeys: readonly string[]): void {
    setSelected((current) => {
      const next = new Set(current)
      for (const key of groupKeys) next.add(key)
      return next
    })
  }

  function handleClearAll(groupKeys: readonly string[]): void {
    setSelected((current) => {
      const next = new Set(current)
      for (const key of groupKeys) next.delete(key)
      return next
    })
  }

  function handleCancel(): void {
    setSelected(new Set(initialSet))
    setError(null)
    setMode('view')
  }

  function handleEnterEdit(): void {
    setError(null)
    setMode('edit')
  }

  function handleEnterView(): void {
    // Disabled while dirty (the toggle's `disabled` prop guards this) —
    // belt-and-suspenders so a stray click can't slip through.
    if (isDirty) return
    setError(null)
    setMode('view')
  }

  async function handleSave(): Promise<void> {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await setRoleAbilities({
        data: { id: role.id, abilities: Array.from(selected) },
      })
      // Reset baseline to the authoritative stored set — guards against
      // any dedupe/normalisation the server might apply.
      const storedSet = new Set(response.abilities)
      setInitialSet(storedSet)
      setSelected(new Set(storedSet))
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
      setSaving(false)
    }
  }

  const isEdit = mode === 'edit'

  return (
    <div className="mb-12 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-gray-100 bg-canvas-25 p-3 dark:border-gray-700 dark:bg-canvas-800">
        <ModeToggle
          mode={mode}
          dirty={isDirty}
          saving={saving}
          onView={handleEnterView}
          onEdit={handleEnterEdit}
        />
        <p className="muted m-0 text-sm">
          <span className="font-medium">{totalSelected}</span> of{' '}
          <span className="font-medium">{registered.total}</span> {isEdit ? 'selected' : 'granted'}{' '}
          for {role.name}
        </p>
        {isEdit && isDirty ? (
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              intent="secondary"
              size="xs"
              onClick={handleCancel}
              disabled={saving}
              className="min-w-16"
            >
              Cancel
            </Button>
            <Button
              type="button"
              intent="primary"
              size="xs"
              onClick={() => void handleSave()}
              disabled={saving}
              className="min-w-16"
            >
              {saving ? <LoaderEllipsis size={30} /> : 'Save'}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <Alert intent="danger">{error}</Alert> : null}

      <div className="flex flex-col gap-2">
        {registered.groups.map((group) => (
          <GroupSection
            key={group.group}
            group={group}
            selected={selected}
            mode={mode}
            saving={saving}
            onToggle={handleToggle}
            onSelectAll={handleSelectAll}
            onClearAll={handleClearAll}
          />
        ))}
      </div>
    </div>
  )
}

interface ModeToggleProps {
  mode: Mode
  dirty: boolean
  saving: boolean
  onView: () => void
  onEdit: () => void
}

function ModeToggle({ mode, dirty, saving, onView, onEdit }: ModeToggleProps) {
  // Segmented two-state toggle. View is disabled while dirty so the
  // user has to commit to Save or Cancel — avoids accidentally
  // discarding a draft selection.
  const isView = mode === 'view'
  const isEdit = mode === 'edit'
  return (
    <div
      role="group"
      aria-label="Permissions mode"
      className="inline-flex overflow-hidden rounded-sm border border-gray-200 dark:border-gray-700"
    >
      <button
        type="button"
        onClick={onView}
        disabled={dirty || saving}
        className={cx(
          'px-2.5 py-0.5 text-xs transition',
          isView
            ? 'bg-gray-100 font-medium dark:bg-canvas-700'
            : 'bg-transparent hover:bg-gray-50 dark:hover:bg-canvas-700',
          (dirty || saving) && !isView && 'opacity-50 cursor-not-allowed'
        )}
      >
        View
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={saving}
        className={cx(
          'border-l border-gray-200 px-2.5 py-0.5 text-xs transition dark:border-gray-700',
          isEdit
            ? 'bg-gray-100 font-medium dark:bg-canvas-700'
            : 'bg-transparent hover:bg-gray-50 dark:hover:bg-canvas-700',
          saving && !isEdit && 'opacity-50 cursor-not-allowed'
        )}
      >
        Edit
      </button>
    </div>
  )
}

function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
