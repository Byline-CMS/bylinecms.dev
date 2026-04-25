'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Self-service change-password drawer form.
 *
 * Distinct from the admin-users `set-password.tsx`:
 *
 *   - Requires the current password as defence against
 *     session-hijack abuse. The server verifies it against the
 *     stored hash before swapping in the new one — wrong current
 *     password surfaces as `admin.account.invalidCurrentPassword`.
 *   - Confirmation field catches typos before round-trip.
 *
 * Caveat: changing the password here does not revoke other active
 * sessions today. Existing access tokens stay valid until expiry
 * (~15 min); a "sign out everywhere on password change" follow-up
 * will close that gap.
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { passwordSchema } from '@byline/core/validation'
import { Alert, Button, InputPassword, LoaderEllipsis } from '@infonomic/uikit/react'
import { z } from 'zod'

import { type AccountResponse, changeAccountPassword } from '../index'

const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Please enter your current password' }),
    newPassword: passwordSchema,
    confirm: z.string({ message: 'Please confirm the new password' }),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'New passwords do not match',
    path: ['confirm'],
  })

type ChangePasswordValues = z.infer<typeof changePasswordFormSchema>

interface ChangePasswordProps {
  account: AccountResponse
  onClose?: () => void
  onSuccess?: (account: AccountResponse) => void
}

export function ChangeAccountPassword({ account, onClose, onSuccess }: ChangePasswordProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' } as ChangePasswordValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: changePasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      try {
        const updated = await changeAccountPassword({
          data: {
            vid: account.vid,
            currentPassword: value.currentPassword,
            newPassword: value.newPassword,
          },
        })
        setSuccessMessage('Password updated.')
        form.reset({ currentPassword: '', newPassword: '', confirm: '' })
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.account.invalidCurrentPassword') {
          form.setFieldMeta('currentPassword', (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: 'Current password is incorrect.' },
            errors: ['Current password is incorrect.'],
          }))
          return
        }
        if (code === 'admin.users.versionConflict') {
          setFormError(
            'Your account has been modified elsewhere since you opened this form. Reload to refresh and try again.'
          )
          return
        }
        if (code === 'admin.account.notFound') {
          setFormError('Your admin account could not be found. Please sign in again.')
          return
        }
        setFormError('Could not change the password. Please try again.')
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

        <p className="muted">
          Other active sessions will continue to work until their tokens expire. Sign out elsewhere
          if you suspect another device has been compromised.
        </p>

        <form.Field name="currentPassword">
          {(field) => (
            <InputPassword
              label="Current password"
              id="currentPassword"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="current-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="newPassword">
          {(field) => (
            <InputPassword
              label="New password"
              id="newPassword"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="new-password"
              required
            />
          )}
        </form.Field>

        <form.Field name="confirm">
          {(field) => (
            <InputPassword
              label="Confirm new password"
              id="confirm"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.currentTarget.value)}
              error={field.state.meta.errors.length > 0}
              errorText={firstError(field.state.meta.errors)}
              autoComplete="new-password"
              required
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
              isDirty: state.isDirty,
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
