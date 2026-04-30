'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Create-admin-role drawer form.
 *
 * Same TanStack Form + Zod shape as the admin-users equivalent. The
 * `machine_name` field is captured at create time only — it is the
 * stable code-side handle for the role and is immutable thereafter
 * (see the repository contract).
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import type { AdminRoleResponse } from '@byline/admin/admin-roles'
import { Alert, Button, Input, LoaderEllipsis, TextArea } from '@infonomic/uikit/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './create.module.css'

const createAdminRoleFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(128, 'Name must not exceed 128 characters'),
  machine_name: z
    .string()
    .min(1, 'Machine name is required')
    .max(128, 'Machine name must not exceed 128 characters')
    .regex(/^[a-z0-9][a-z0-9_-]*$/, {
      message: 'Lowercase letters, numbers, hyphens, and underscores only',
    }),
  description: z.string().max(2000, 'Description must not exceed 2000 characters'),
})

type CreateAdminRoleValues = z.infer<typeof createAdminRoleFormSchema>

const initialValues: CreateAdminRoleValues = {
  name: '',
  machine_name: '',
  description: '',
}

function normaliseText(value: string): string | null {
  return value.trim().length > 0 ? value : null
}

interface CreateAdminRoleProps {
  onClose?: () => void
  onSuccess?: (role: AdminRoleResponse) => void
}

export function CreateAdminRole({ onClose, onSuccess }: CreateAdminRoleProps) {
  const { createAdminRole } = useBylineAdminServices()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: createAdminRoleFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      try {
        const created = await createAdminRole({
          data: {
            name: value.name.trim(),
            machine_name: value.machine_name.trim(),
            description: normaliseText(value.description),
          },
        })
        form.reset(initialValues)
        onSuccess?.(created)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.roles.machineNameInUse') {
          form.setFieldMeta('machine_name', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: 'This machine name is already in use.' },
            errors: ['This machine name is already in use.'],
          }))
          return
        }
        setFormError('Could not create this admin role. Please try again.')
      }
    },
  })

  return (
    <div className={cx('byline-role-create-wrap', styles.wrap)}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-role-create-form', styles.form)}
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}

        <form.Field name="name">
          {(field) => (
            <Input
              label="Name"
              id="new-role-name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText="Human-readable label, e.g. 'Editor'."
              required
            />
          )}
        </form.Field>

        <form.Field name="machine_name">
          {(field) => (
            <Input
              label="Machine name"
              id="new-role-machine-name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText="Stable code-side handle, e.g. 'editor'. Cannot be changed later."
              required
            />
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <TextArea
              label="Description"
              id="new-role-description"
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

        <div className={cx('byline-role-create-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-role-create-action', styles.action)}
          >
            Cancel
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
                className={cx('byline-role-create-action', styles.action)}
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
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; cause?: unknown }
    if (typeof e.code === 'string') return e.code
    if (e.cause && typeof e.cause === 'object' && 'code' in e.cause) {
      const cause = e.cause as { code?: unknown }
      if (typeof cause.code === 'string') return cause.code
    }
  }
  return null
}
