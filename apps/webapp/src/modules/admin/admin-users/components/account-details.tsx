'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Account details drawer form.
 *
 * Client-side validation runs through TanStack Form's `onDynamic` +
 * Zod — same rules the server uses, re-declared here so field errors
 * show up without a network round-trip. On submit the form diffs
 * against the original row and sends only the *changed* fields as a
 * patch, plus the `vid` the form was opened with, so a concurrent edit
 * elsewhere comes back as `admin.users.versionConflict` and we surface
 * a reload prompt.
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { Alert, Button, Checkbox, Input } from '@infonomic/uikit/react'
import { z } from 'zod'

import { updateAdminUser } from '../index'
import type { AdminUserResponse } from '../index'

const accountDetailsSchema = z.object({
  given_name: z.string().max(100, 'Given name must not exceed 100 characters'),
  family_name: z.string().max(100, 'Family name must not exceed 100 characters'),
  username: z.string().max(100, 'Username must not exceed 100 characters'),
  email: z
    .email({ message: 'Enter a valid email address' })
    .min(3)
    .max(254, 'Email must not exceed 254 characters'),
  is_super_admin: z.boolean(),
  is_enabled: z.boolean(),
  is_email_verified: z.boolean(),
})

type AccountDetailsValues = z.infer<typeof accountDetailsSchema>

function defaultsFrom(user: AdminUserResponse): AccountDetailsValues {
  return {
    given_name: user.given_name ?? '',
    family_name: user.family_name ?? '',
    username: user.username ?? '',
    email: user.email,
    is_super_admin: user.is_super_admin,
    is_enabled: user.is_enabled,
    is_email_verified: user.is_email_verified,
  }
}

/** Build a patch object containing only fields whose values differ from the original user row. */
function buildPatch(values: AccountDetailsValues, user: AdminUserResponse) {
  const patch: {
    given_name?: string | null
    family_name?: string | null
    username?: string | null
    email?: string
    is_super_admin?: boolean
    is_enabled?: boolean
    is_email_verified?: boolean
  } = {}
  // Text fields: treat empty string as null (clear). null === null matches,
  // '' → null ≠ current null stays consistent.
  const normaliseText = (value: string): string | null => (value.trim().length > 0 ? value : null)
  const nextGiven = normaliseText(values.given_name)
  const nextFamily = normaliseText(values.family_name)
  const nextUsername = normaliseText(values.username)

  if (nextGiven !== user.given_name) patch.given_name = nextGiven
  if (nextFamily !== user.family_name) patch.family_name = nextFamily
  if (nextUsername !== user.username) patch.username = nextUsername
  if (values.email !== user.email) patch.email = values.email
  if (values.is_super_admin !== user.is_super_admin) patch.is_super_admin = values.is_super_admin
  if (values.is_enabled !== user.is_enabled) patch.is_enabled = values.is_enabled
  if (values.is_email_verified !== user.is_email_verified)
    patch.is_email_verified = values.is_email_verified
  return patch
}

interface AccountDetailsProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

export function AccountDetails({ user, onClose, onSuccess }: AccountDetailsProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: defaultsFrom(user),
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: accountDetailsSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      const patch = buildPatch(value, user)
      if (Object.keys(patch).length === 0) {
        setSuccessMessage('No changes to save.')
        return
      }

      try {
        const updated = await updateAdminUser({
          data: { id: user.id, vid: user.vid, patch },
        })
        setSuccessMessage('Saved.')
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.emailInUse') {
          // Surface on the email field directly.
          form.setFieldMeta('email', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: 'This email is already in use.' },
            errors: ['This email is already in use.'],
          }))
          return
        }
        if (code === 'admin.users.versionConflict') {
          setFormError(
            'This user has been modified elsewhere since you opened this form. Reload to get the latest values and try again.'
          )
          return
        }
        if (code === 'admin.users.notFound') {
          setFormError('This user no longer exists.')
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
        className="flex flex-col gap-4 pt-2`"
      >
        {formError ? <Alert intent="danger">{formError}</Alert> : null}
        {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

        <form.Field name="given_name">
          {(field) => (
            <Input
              label="Given name"
              id="given_name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="given-name"
            />
          )}
        </form.Field>

        <form.Field name="family_name">
          {(field) => (
            <Input
              label="Family name"
              id="family_name"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="family-name"
            />
          )}
        </form.Field>

        <form.Field name="username">
          {(field) => (
            <Input
              label="Username"
              id="username"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              helpText="Optional. Leave blank to clear."
              autoComplete="username"
            />
          )}
        </form.Field>

        <form.Field name="email">
          {(field) => (
            <Input
              label="Email"
              id="email"
              name={field.name}
              type="email"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="email"
              required
            />
          )}
        </form.Field>

        <div className="flex flex-col gap-2 p-1">
          <form.Field name="is_enabled">
            {(field) => (
              <Checkbox
                id="is_enabled"
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
                id="is_email_verified"
                name={field.name}
                label="Email verified"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked === true)}
              />
            )}
          </form.Field>

          <form.Field name="is_super_admin">
            {(field) => (
              <Checkbox
                id="is_super_admin"
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
            {successMessage ? 'Close' : 'Cancel'}
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              isDirty: state.isDirty,
            })}
          >
            {({ canSubmit, isSubmitting, isDirty }) => (
              <Button type="submit" size="sm" disabled={!canSubmit || !isDirty || isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save changes'}
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

/**
 * Extract the admin-users error code from a thrown server-fn response.
 * TanStack Start surfaces thrown `AdminUsersError` / `AuthError` with the
 * original `code` property intact; the wrapper may wrap it once more,
 * so we look a level deeper if needed.
 */
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
