'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Set-password drawer form.
 *
 * Admin-facing "set this user's password" flow — used when an admin is
 * resetting someone else's password. Server-side policy (min 12 chars,
 * max 256) is duplicated client-side via Zod for immediate field
 * validation. A matching-confirmation field catches typos without a
 * round-trip.
 *
 * The server fn returns the updated user so we can lift the bumped
 * `vid` back into the container; the drawer doesn't need to re-fetch.
 */

import { useState } from 'react'
import { revalidateLogic, useForm } from '@tanstack/react-form-start'

import { passwordSchema } from '@byline/core/validation'
import { Alert, Button, Input } from '@infonomic/uikit/react'
import { z } from 'zod'

import { setAdminUserPassword } from '../index'
import type { AdminUserResponse } from '../index'

const setPasswordFormSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string({ message: 'Please confirm the password' }),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

type SetPasswordValues = z.infer<typeof setPasswordFormSchema>

interface SetPasswordProps {
  user: AdminUserResponse
  onClose?: () => void
  onSuccess?: (user: AdminUserResponse) => void
}

export function SetPassword({ user, onClose, onSuccess }: SetPasswordProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { password: '', confirm: '' } as SetPasswordValues,
    validationLogic: revalidateLogic({
      mode: 'blur',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onDynamic: setPasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)
      try {
        const updated = await setAdminUserPassword({
          data: { id: user.id, vid: user.vid, password: value.password },
        })
        setSuccessMessage('Password updated.')
        form.reset({ password: '', confirm: '' })
        onSuccess?.(updated)
      } catch (err) {
        const code = getErrorCode(err)
        if (code === 'admin.users.versionConflict') {
          setFormError(
            'This user has been modified elsewhere since you opened this form. Reload to refresh and try again.'
          )
          return
        }
        if (code === 'admin.users.notFound') {
          setFormError('This user no longer exists.')
          return
        }
        setFormError('Could not set the password. Please try again.')
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
      {successMessage ? <Alert intent="success">{successMessage}</Alert> : null}

      <p className="muted">
        Sets a new password for <span className="font-semibold">{user.email}</span>. The user will
        need to sign in again with the new password.
      </p>

      <form.Field name="password">
        {(field) => (
          <Input
            label="New password"
            id="password"
            name={field.name}
            type="password"
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
          <Input
            label="Confirm new password"
            id="confirm"
            name={field.name}
            type="password"
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
              {isSubmitting ? 'Saving…' : 'Set password'}
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
