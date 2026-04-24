'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Role details drawer form.
 *
 * Mirrors the admin-users update pattern: TanStack Form + Zod, blur-then-
 * change validation, diff-against-original patch, optimistic concurrency
 * via `vid`. `machine_name` is read-only here — it is captured at create
 * time and immutable thereafter.
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { Alert, Button, Input, LoaderEllipsis, TextArea } from '@infonomic/uikit/react'
import { z } from 'zod'

import { updateAdminRole } from '../index'
import type { AdminRoleResponse, UpdateAdminRoleInput } from '../index'

const updateRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(128, 'Name must not exceed 128 characters'),
  description: z.string().max(2000, 'Description must not exceed 2000 characters'),
})

type UpdateRoleValues = z.infer<typeof updateRoleSchema>

function defaultsFrom(role: AdminRoleResponse): UpdateRoleValues {
  return {
    name: role.name,
    description: role.description ?? '',
  }
}

/** Build a patch object containing only fields whose values differ from the original role. */
function buildPatch(
  values: UpdateRoleValues,
  role: AdminRoleResponse
): UpdateAdminRoleInput['patch'] {
  const patch: UpdateAdminRoleInput['patch'] = {}
  const normaliseText = (value: string): string | null => (value.trim().length > 0 ? value : null)
  const nextDescription = normaliseText(values.description)
  const nextName = values.name.trim()

  if (nextName !== role.name) patch.name = nextName
  if (nextDescription !== role.description) patch.description = nextDescription
  return patch
}

interface UpdateRoleProps {
  role: AdminRoleResponse
  onClose?: () => void
  onSuccess?: (role: AdminRoleResponse) => void
}

export function UpdateRole({ role, onClose, onSuccess }: UpdateRoleProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: defaultsFrom(role),
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: updateRoleSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      const patch = buildPatch(value, role)
      if (Object.keys(patch).length === 0) {
        setSuccessMessage('No changes to save.')
        return
      }

      try {
        const updated = await updateAdminRole({
          data: { id: role.id, vid: role.vid, patch },
        })
        setSuccessMessage('Saved.')
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.roles.versionConflict') {
          setFormError(
            'This role has been modified elsewhere since you opened this form. Reload to get the latest values and try again.'
          )
          return
        }
        if (code === 'admin.roles.notFound') {
          setFormError('This role no longer exists.')
          return
        }
        setFormError('Could not save changes. Please try again.')
      }
    },
  })

  return (
    <div className="form flex flex-col gap-2 p-1 mt-1">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-4 pt-2"
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <form.Field name="name">
          {(field) => (
            <Input
              label="Name"
              id="role-name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              required
            />
          )}
        </form.Field>

        <Input
          label="Machine name"
          id="role-machine-name"
          name="machine_name"
          value={role.machine_name}
          readOnly
          disabled
          helpText="The stable code-side handle. Cannot be changed after creation."
        />

        <form.Field name="description">
          {(field) => (
            <TextArea
              label="Description"
              id="role-description"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              rows={3}
            />
          )}
        </form.Field>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" intent="secondary" size="sm" onClick={onClose} className="min-w-16">
            {successMessage ? 'Close' : 'Cancel'}
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                size="sm"
                intent="primary"
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="min-w-16"
              >
                {isSubmitting === true ? <LoaderEllipsis size={42} /> : 'Save'}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </div>
  )
}

function firstError(errors: readonly unknown[]): string | undefined {
  for (const err of errors) {
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === 'string') return msg
    }
  }
  return undefined
}

function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
