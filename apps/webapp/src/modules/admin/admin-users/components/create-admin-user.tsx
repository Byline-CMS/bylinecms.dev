'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Create-admin-user drawer form.
 *
 * Rendered inside the list-view drawer. Same TanStack Form + Zod shape
 * as the AccountDetails form — fields, blur-then-change validation,
 * form-level alerts for errors that don't map onto a single field. On
 * success the parent list-view navigates to the new user's detail page
 * so the admin can finish configuring (roles, initial enablement).
 *
 * Extension point: future props (e.g. a `roles` array once the
 * admin-roles module lands) plug in here — the list-route loader
 * already runs in parallel, so adding a side-data fetch is a one-line
 * change in the loader and a prop here.
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { Alert, Button, Checkbox, Input } from '@infonomic/uikit/react'
import { z } from 'zod'

import { createAdminUser } from '../index'
import type { AdminUserResponse } from '../index'

const createAdminUserFormSchema = z.object({
  email: z
    .email({ message: 'Enter a valid email address' })
    .min(3)
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string({ message: 'Password is required' })
    .min(12, 'Password must be at least 12 characters')
    .max(256, 'Password must not exceed 256 characters'),
  given_name: z.string().max(100, 'Given name must not exceed 100 characters'),
  family_name: z.string().max(100, 'Family name must not exceed 100 characters'),
  username: z.string().max(100, 'Username must not exceed 100 characters'),
  is_super_admin: z.boolean(),
  is_enabled: z.boolean(),
  is_email_verified: z.boolean(),
})

type CreateAdminUserValues = z.infer<typeof createAdminUserFormSchema>

const initialValues: CreateAdminUserValues = {
  email: '',
  password: '',
  given_name: '',
  family_name: '',
  username: '',
  is_super_admin: false,
  // Sensible defaults for an admin-created row. A brand-new admin user
  // is almost always meant to sign in straight away; the admin picks
  // whether they arrive pre-verified.
  is_enabled: true,
  is_email_verified: false,
}

function normaliseText(value: string): string | null {
  return value.trim().length > 0 ? value : null
}

interface CreateAdminUserProps {
  onClose?: () => void
  /** Called on successful create with the new user so the parent can navigate. */
  onSuccess?: (user: AdminUserResponse) => void
}

export function CreateAdminUser({ onClose, onSuccess }: CreateAdminUserProps) {
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: initialValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: createAdminUserFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      try {
        const created = await createAdminUser({
          data: {
            email: value.email,
            password: value.password,
            given_name: normaliseText(value.given_name),
            family_name: normaliseText(value.family_name),
            username: normaliseText(value.username),
            is_super_admin: value.is_super_admin,
            is_enabled: value.is_enabled,
            is_email_verified: value.is_email_verified,
          },
        })
        onSuccess?.(created)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.emailInUse') {
          form.setFieldMeta('email', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: 'This email is already in use.' },
            errors: ['This email is already in use.'],
          }))
          return
        }
        setFormError('Could not create this admin user. Please try again.')
      }
    },
  })

  return (
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

      <form.Field name="email">
        {(field) => (
          <Input
            label="Email"
            id="new-email"
            name={field.name}
            type="email"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.currentTarget.value)}
            errorText={firstError(field.state.meta.errors)}
            autoComplete="email"
            required
          />
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <Input
            label="Initial password"
            id="new-password"
            name={field.name}
            type="password"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.currentTarget.value)}
            errorText={firstError(field.state.meta.errors)}
            helpText="The user can change it from their own account after signing in."
            autoComplete="new-password"
            required
          />
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="given_name">
          {(field) => (
            <Input
              label="Given name"
              id="new-given-name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="given-name"
            />
          )}
        </form.Field>

        <form.Field name="family_name">
          {(field) => (
            <Input
              label="Family name"
              id="new-family-name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="family-name"
            />
          )}
        </form.Field>
      </div>

      <form.Field name="username">
        {(field) => (
          <Input
            label="Username"
            id="new-username"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(e) => field.handleChange(e.currentTarget.value)}
            errorText={firstError(field.state.meta.errors)}
            helpText="Optional."
            autoComplete="username"
          />
        )}
      </form.Field>

      <div className="flex flex-col gap-2">
        <form.Field name="is_enabled">
          {(field) => (
            <Checkbox
              id="new-is-enabled"
              name={field.name}
              label="Enabled"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
              helpText="Disabled accounts cannot sign in."
            />
          )}
        </form.Field>

        <form.Field name="is_email_verified">
          {(field) => (
            <Checkbox
              id="new-is-email-verified"
              name={field.name}
              label="Email verified"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
              helpText="Skip the verification flow for this account."
            />
          )}
        </form.Field>

        <form.Field name="is_super_admin">
          {(field) => (
            <Checkbox
              id="new-is-super-admin"
              name={field.name}
              label="Super admin"
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked === true)}
              helpText="Super admins bypass every ability check — grant with care."
            />
          )}
        </form.Field>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" intent="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" size="sm" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create admin user'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
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
