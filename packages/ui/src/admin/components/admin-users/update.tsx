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

import type { AdminUserResponse } from '@byline/admin/admin-users'
import { Alert, Button, Checkbox, Input, LoaderEllipsis } from '@infonomic/uikit/react'
import cx from 'classnames'
import { z } from 'zod'

import { useBylineAdminServices } from '../../../services/admin-services-context.js'
import styles from './update.module.css'

const updateUserSchema = z.object({
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

type UpdateUserValues = z.infer<typeof updateUserSchema>

function defaultsFrom(user: AdminUserResponse): UpdateUserValues {
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
function buildPatch(values: UpdateUserValues, user: AdminUserResponse) {
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

interface UpdateUserProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

export function UpdateUser({ user, onClose, onSuccess }: UpdateUserProps) {
  const { updateAdminUser } = useBylineAdminServices()
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: defaultsFrom(user),
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: updateUserSchema,
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
    <div className={cx('byline-user-update-wrap', styles.wrap)}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className={cx('byline-user-update-form', styles.form)}
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

        <div className={cx('byline-user-update-flags', styles.flags)}>
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

        <div className={cx('byline-user-update-actions', styles.actions)}>
          <Button
            type="button"
            intent="secondary"
            size="sm"
            onClick={onClose}
            className={cx('byline-user-update-action', styles.action)}
          >
            {successMessage ? 'Close' : 'Cancel'}
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
              isDirty: state.isDirty,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                size="sm"
                intent="primary"
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className={cx('byline-user-update-action', styles.action)}
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

/**
 * Extract the admin-users error code from a thrown server-fn response.
 * Typed errors (`AdminUsersError`, `AuthError`) survive the server-fn
 * boundary with their `code` intact thanks to the `BylineCodedError`
 * serialization adapter registered in `src/start.ts`.
 */
function getErrorCode(err: unknown): string | null {
  return typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : null
}
